//! Local-model catalog and on-disk model store.
//!
//! tugcast owns two things about local models: which ones exist (the compiled
//! catalog below) and which ones are on disk (the store). It owns nothing
//! about running them — that lives in the Swift service, which discovers
//! installed models by reading the `tug-manifest.json` stamps this module
//! writes and never sees the catalog at all.
//!
//! The stamp is the presence probe. A model directory without a readable,
//! revision-matching stamp is a partial download, not an installed model, and
//! both sides agree on that rule.

use std::collections::HashMap;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};
use tugcast_core::{FeedId, Frame};

// MARK: - Catalog

/// One file in a model pack, pinned by content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelFile {
    pub name: &'static str,
    pub sha256: &'static str,
    pub bytes: u64,
}

/// A model Tug knows how to acquire and run.
#[derive(Debug, Clone, Copy)]
pub struct CatalogEntry {
    pub id: &'static str,
    pub display_name: &'static str,
    /// The default offer during setup. Only an `offered` entry may be
    /// recommended.
    pub recommended: bool,
    /// Whether setup surfaces this entry at all. A non-offered entry is
    /// otherwise fully supported: downloadable, selectable, and eligible for
    /// `auto` once installed. It simply is not part of the first-run choice.
    pub offered: bool,
    pub hf_repo: &'static str,
    /// Full commit hash, so the resolve URLs below are immutable.
    pub hf_revision: &'static str,
    pub files: &'static [ModelFile],
    pub total_bytes: u64,
    pub context_window: u32,
    pub notes: &'static str,
}

impl CatalogEntry {
    /// Download URL for one of this entry's files. `base` is injectable so
    /// tests can point the downloader at a local server.
    pub fn file_url(&self, base: &str, file: &ModelFile) -> String {
        format!(
            "{}/{}/resolve/{}/{}",
            base.trim_end_matches('/'),
            self.hf_repo,
            self.hf_revision,
            file.name
        )
    }
}

/// The models Tug ships knowledge of, in preference order.
///
/// Order is the mechanism, not decoration: `catalog_rank` is position, and a user
/// on `auto` resolves to the first entry they have installed. Exactly one entry is
/// `offered`, because two multi-gigabyte downloads is not a configuration this app
/// asks anyone to accept.
///
/// `qwen3-4b-instruct-2507-4bit` holds that place on a three-way bake-off across
/// both jobs, decided against criteria fixed before the numbers were taken. It
/// reached for the executing SHELL verdict once in 36 prose lines where the other
/// two reached 2 and 17 times, and it needed the register normalizer zero times in
/// 13 headlines where the incumbent needed it three. The two entries below it lost
/// on those, not on size or speed, and they stay here fully supported —
/// downloadable, selectable, `auto`-eligible once installed — because a user who
/// already has one should not be stranded by a ruling made after they installed it.
///
/// Repo furniture — `README.md`, `LICENSE`, `.gitattributes`, evaluation
/// artifacts — is deliberately absent: MLX never reads it, so it is never
/// downloaded. Every `sha256` here was computed from the exact bytes that
/// were scored during bring-up.
///
/// An entry is only listable if its `config.json` `model_type` is registered in
/// mlx-swift-examples' `LLMModelFactory`; the Swift backend imports MLXLLM and
/// resolves the architecture from that registry, so an unregistered pack fails
/// the load rather than degrading. `mistral3` and `gemma4` are absent upstream,
/// which rules out the Ministral 3 and Gemma 4 families at the current pin.
pub const CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        id: "qwen3-4b-instruct-2507-4bit",
        display_name: "Qwen3 4B Instruct",
        recommended: true,
        offered: true,
        hf_repo: "mlx-community/Qwen3-4B-Instruct-2507-4bit",
        hf_revision: "50d427756c6b1b2fe0c0a10f67fbda1fc8e82c1b",
        files: &[
            ModelFile {
                name: "added_tokens.json",
                sha256: "c0284b582e14987fbd3d5a2cb2bd139084371ed9acbae488829a1c900833c680",
                bytes: 707,
            },
            ModelFile {
                name: "chat_template.jinja",
                sha256: "40c21f34cf67d8c760ef72f8ad3ae5afad514299d4b06e91dd9a8d705af7b541",
                bytes: 4040,
            },
            ModelFile {
                name: "config.json",
                sha256: "574349e5a343236546fda55e4744a76e181f534182d7dc60ff1bad7e7a502849",
                bytes: 938,
            },
            ModelFile {
                name: "generation_config.json",
                sha256: "835fffe355c9438e7a25be099b3fccaa98350b83451f9fd2d99512e74f1ade48",
                bytes: 238,
            },
            ModelFile {
                name: "merges.txt",
                sha256: "8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5",
                bytes: 1671853,
            },
            ModelFile {
                name: "model.safetensors",
                sha256: "2a73c6c248601ab904e035548abd8e6abb65ea27dcb5f342fb0a8910eb44173f",
                bytes: 2263022417,
            },
            ModelFile {
                name: "model.safetensors.index.json",
                sha256: "388d811b8b7c2608dd04cce1bcb04a8bf715d19b42790894e6d3427ff429a777",
                bytes: 63964,
            },
            ModelFile {
                name: "special_tokens_map.json",
                sha256: "76862e765266b85aa9459767e33cbaf13970f327a0e88d1c65846c2ddd3a1ecd",
                bytes: 613,
            },
            ModelFile {
                name: "tokenizer.json",
                sha256: "aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4",
                bytes: 11422654,
            },
            ModelFile {
                name: "tokenizer_config.json",
                sha256: "4397cc477eb6d79715ccd2000accd6b3531928f30029665832fa1b255f24d2b9",
                bytes: 5440,
            },
            ModelFile {
                name: "vocab.json",
                sha256: "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910",
                bytes: 2776833,
            },
        ],
        total_bytes: 2278969697,
        context_window: 262144,
        notes: "Reads your command lines and writes your session headlines.",
    },
    CatalogEntry {
        id: "ternary-bonsai-8b-2bit",
        display_name: "Ternary Bonsai 8B",
        recommended: false,
        offered: false,
        hf_repo: "prism-ml/Ternary-Bonsai-8B-mlx-2bit",
        hf_revision: "9260b24298e4211e804663e9f519962cf59f34be",
        files: &[
            ModelFile {
                name: "chat_template.jinja",
                sha256: "30a75d10e60b57e2f260420163dd59720dacf9f63b9a8de070d65dd80a7b30f7",
                bytes: 4063,
            },
            ModelFile {
                name: "config.json",
                sha256: "c9a8bbb4b2b682d0e2d2bf4f537d699e1a569d757b2918c480e82a0c77b060ba",
                bytes: 3118,
            },
            ModelFile {
                name: "model.safetensors",
                sha256: "f43270cbae86830b7eecb25bb8a0a0a005a81f180b68868dc39c755cebfff362",
                bytes: 2303661704,
            },
            ModelFile {
                name: "model.safetensors.index.json",
                sha256: "178ab2bf39b603d669f730e569045e69886e117a392f4c75cd148f1733add0b4",
                bytes: 64065,
            },
            ModelFile {
                name: "tokenizer.json",
                sha256: "be75606093db2094d7cd20f3c2f385c212750648bd6ea4fb2bf507a6a4c55506",
                bytes: 11422650,
            },
            ModelFile {
                name: "tokenizer_config.json",
                sha256: "579073f506a3f85caed232bb91617cfb93028408d1f43ffaf66f3fc1aee9a9af",
                bytes: 348,
            },
        ],
        total_bytes: 2315155948,
        context_window: 65536,
        notes: "2-bit ternary 8B pack. Superseded; kept for anyone already holding it.",
    },
    CatalogEntry {
        id: "lfm25-1-2b-instruct-4bit",
        display_name: "LFM2.5 1.2B Instruct",
        recommended: false,
        offered: false,
        hf_repo: "mlx-community/LFM2.5-1.2B-Instruct-4bit",
        hf_revision: "125e006d991147f3b432249d1bdf0821987f12b0",
        files: &[
            ModelFile {
                name: "chat_template.jinja",
                sha256: "f05bf4b967dc993bdc7a2fe6e43759ee218eb0eb340d68b063e1c4f8ad148176",
                bytes: 1783,
            },
            ModelFile {
                name: "config.json",
                sha256: "3201758c1b68e92a8102583626b0d76f70ff4c6fc2e2b99d32e96cdbe6788cea",
                bytes: 1572,
            },
            ModelFile {
                name: "generation_config.json",
                sha256: "5ffd97da1dec4308543894569662d96e923ed01f7a9d8c7ff5aea7f800738cbd",
                bytes: 132,
            },
            ModelFile {
                name: "model.safetensors.index.json",
                sha256: "3074009e9be56358bf8edc25354572cbca2b5a625e02f8a2c2789a656f51f5a1",
                bytes: 23414,
            },
            ModelFile {
                name: "model.safetensors",
                sha256: "d837f243744bbdbe7dd032f90b482a1c45d5b6035b25c1d7804d0f4c74b5c004",
                bytes: 658540250,
            },
            ModelFile {
                name: "special_tokens_map.json",
                sha256: "742aefe2b7dec496e8caffdba03a75d0c1a9925d53bd3f3e0d388c96b591b6f4",
                bytes: 434,
            },
            ModelFile {
                name: "tokenizer.json",
                sha256: "df1d8d5ec5d091b460562ffd545e4a5e91d17d4a0db7ebe733be34ed374377bd",
                bytes: 4733389,
            },
            ModelFile {
                name: "tokenizer_config.json",
                sha256: "2a52ec012d3df831ba434b081bef3726a6ee22501f062ad8353c557a0cfa0d01",
                bytes: 92225,
            },
        ],
        total_bytes: 663393199,
        context_window: 128000,
        notes: "1.2B on-device pack, a third the download. Too small for headline work.",
    },
];

/// Look up a catalog entry and its rank (position, 0 = recommended default).
pub fn catalog_entry(id: &str) -> Option<(usize, &'static CatalogEntry)> {
    CATALOG
        .iter()
        .position(|e| e.id == id)
        .map(|i| (i, &CATALOG[i]))
}

// MARK: - Store layout

/// Root of the model store, shared by every instance on the machine.
pub fn models_root() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir().map(|home| home.join("Library/Application Support/Tug/models"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        dirs::data_dir().map(|data| data.join("Tug/models"))
    }
}

/// Where an installed model lives.
pub fn model_dir(root: &Path, id: &str) -> PathBuf {
    root.join(id)
}

/// Where in-flight downloads accumulate their `.part` files and locks.
pub fn staging_dir(root: &Path) -> PathBuf {
    root.join(".staging")
}

pub fn stamp_path(root: &Path, id: &str) -> PathBuf {
    model_dir(root, id).join(STAMP_NAME)
}

pub const STAMP_NAME: &str = "tug-manifest.json";

// MARK: - Stamp

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StampFile {
    pub name: String,
    pub sha256: String,
    pub bytes: u64,
}

/// The record written once a pack has fully verified.
///
/// `catalog_rank` is copied in at finalize time so the Swift service can order
/// installed models without any catalog knowledge of its own.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Stamp {
    pub v: u32,
    pub id: String,
    pub hf_repo: String,
    pub hf_revision: String,
    pub files: Vec<StampFile>,
    pub backend: String,
    pub context_window: u32,
    pub catalog_rank: usize,
    pub verified_at: String,
}

pub fn read_stamp(root: &Path, id: &str) -> Option<Stamp> {
    let text = fs::read_to_string(stamp_path(root, id)).ok()?;
    serde_json::from_str(&text).ok()
}

/// Whether this catalog entry is installed *at the revision the catalog now
/// names*.
///
/// A revision bump therefore reads as not-installed, which is what makes model
/// upgrades ordinary: the normal download path acquires the new pack.
pub fn is_installed(root: &Path, entry: &CatalogEntry) -> bool {
    let Some(stamp) = read_stamp(root, entry.id) else {
        return false;
    };
    if stamp.id != entry.id || stamp.hf_revision != entry.hf_revision {
        return false;
    }
    let dir = model_dir(root, entry.id);
    entry.files.iter().all(|file| {
        fs::metadata(dir.join(file.name))
            .map(|meta| meta.len() == file.bytes)
            .unwrap_or(false)
    })
}

/// Bring every installed pack's recorded `catalog_rank` back in line with the
/// catalog, and report how many had drifted.
///
/// The rank is copied into the stamp at install time so the Swift service can
/// order packs without knowing the catalog — which means reordering `CATALOG`
/// does *not* reorder what is already on disk. Without this, a user who installed
/// the old recommended pack keeps a stamp claiming rank 0 forever, and
/// `resolveRoute`'s `auto` branch — which takes `installed().first`, sorted by the
/// stamp's rank — hands them the retired pack no matter what the catalog now says.
/// A ruling that only applies to people who install after it is not a ruling.
///
/// Only the rank is rewritten. The revision, the file digests and `verified_at`
/// are facts about bytes that were checked once, and nothing here re-checks them.
///
/// Called once from `main`, not from `LocalModelState::shared_default` — the
/// state is constructed wherever a router is, including in tests, and this writes
/// to the shared models directory that every instance on the machine reads.
pub fn reconcile_catalog_ranks(root: &Path) -> usize {
    let mut fixed = 0;
    for (rank, entry) in CATALOG.iter().enumerate() {
        let Some(stamp) = read_stamp(root, entry.id) else {
            continue;
        };
        let was = stamp.catalog_rank;
        if was == rank {
            continue;
        }
        let updated = Stamp {
            catalog_rank: rank,
            ..stamp
        };
        if let Ok(text) = serde_json::to_string_pretty(&updated) {
            if fs::write(stamp_path(root, entry.id), text).is_ok() {
                info!(
                    model = entry.id,
                    was,
                    now = rank,
                    "local model: catalog rank reconciled",
                );
                fixed += 1;
            }
        }
    }
    fixed
}

/// Write the stamp that marks a pack installed. Call only after every file has
/// verified.
pub fn write_stamp(root: &Path, entry: &CatalogEntry, rank: usize) -> io::Result<Stamp> {
    let stamp = Stamp {
        v: 1,
        id: entry.id.to_string(),
        hf_repo: entry.hf_repo.to_string(),
        hf_revision: entry.hf_revision.to_string(),
        files: entry
            .files
            .iter()
            .map(|f| StampFile {
                name: f.name.to_string(),
                sha256: f.sha256.to_string(),
                bytes: f.bytes,
            })
            .collect(),
        backend: "mlx".to_string(),
        context_window: entry.context_window,
        catalog_rank: rank,
        verified_at: chrono::Utc::now().to_rfc3339(),
    };
    let dir = model_dir(root, entry.id);
    fs::create_dir_all(&dir)?;
    let text = serde_json::to_string_pretty(&stamp)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(dir.join(STAMP_NAME), text)?;
    Ok(stamp)
}

/// Remove an installed model, stamp included.
pub fn remove_model(root: &Path, id: &str) -> io::Result<()> {
    let dir = model_dir(root, id);
    if dir.exists() {
        fs::remove_dir_all(dir)?;
    }
    Ok(())
}

// MARK: - Verification

/// Stream a file through SHA-256 and compare against the expected digest.
pub fn verify_file(path: &Path, expected_sha256: &str) -> io::Result<bool> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let digest = hasher.finalize();
    Ok(hex_lower(&digest) == expected_sha256)
}

fn hex_lower(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut acc, b| {
            let _ = write!(acc, "{b:02x}");
            acc
        })
}

// MARK: - Cross-process lock

/// Holds `models/.staging/<id>.lock` for the life of a download.
///
/// The lock is a file containing the owning pid, created `O_EXCL`. A crashed
/// Tug leaves one behind, so a lock whose pid is no longer alive is reclaimed
/// rather than blocking downloads forever.
pub struct DownloadLock {
    path: PathBuf,
}

#[derive(Debug)]
pub enum LockError {
    Busy,
    Io(io::Error),
}

impl std::fmt::Display for LockError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LockError::Busy => write!(f, "download in progress in another Tug instance"),
            LockError::Io(e) => write!(f, "{e}"),
        }
    }
}

impl Drop for DownloadLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn process_alive(pid: i32) -> bool {
    if pid <= 0 {
        return false;
    }
    // Signal 0 tests for existence without delivering anything.
    unsafe {
        libc::kill(pid, 0) == 0
            || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
}

pub fn acquire_download_lock(root: &Path, id: &str) -> Result<DownloadLock, LockError> {
    use std::os::unix::fs::OpenOptionsExt;

    let staging = staging_dir(root);
    fs::create_dir_all(&staging).map_err(LockError::Io)?;
    let path = staging.join(format!("{id}.lock"));

    for attempt in 0..2 {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o644)
            .open(&path)
        {
            Ok(mut file) => {
                use std::io::Write;
                let _ = write!(file, "{}", std::process::id());
                return Ok(DownloadLock { path });
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists && attempt == 0 => {
                let owner = fs::read_to_string(&path)
                    .ok()
                    .and_then(|text| text.trim().parse::<i32>().ok())
                    .unwrap_or(0);
                if process_alive(owner) {
                    return Err(LockError::Busy);
                }
                // Stale: the owner died mid-download. Reclaim and retry once.
                let _ = fs::remove_file(&path);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => return Err(LockError::Busy),
            Err(e) => return Err(LockError::Io(e)),
        }
    }
    Err(LockError::Busy)
}

// MARK: - Downloader

pub const DEFAULT_BASE_URL: &str = "https://huggingface.co";
/// Attempts per file before the download gives up.
const FILE_ATTEMPTS: u32 = 3;
/// Progress frames are rate-limited to this spacing.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

/// An in-flight download: its cancel token and running byte count.
struct ActiveDownload {
    cancel: CancellationToken,
    received: Arc<AtomicU64>,
}

/// Everything the CONTROL verbs need to reach the model store.
pub struct LocalModelState {
    pub root: PathBuf,
    /// Injectable so tests download from a local server.
    pub base_url: String,
    active: Mutex<HashMap<String, ActiveDownload>>,
    /// The socket-backed requester, installed once the control socket exists.
    /// Absent when tugcast runs headless — every task request then answers
    /// unavailable rather than hanging.
    requester: Mutex<Option<Arc<LocalModelRequester>>>,
}

pub type SharedLocalModelState = Arc<LocalModelState>;

impl LocalModelState {
    pub fn new(root: PathBuf, base_url: String) -> SharedLocalModelState {
        Arc::new(Self {
            root,
            base_url,
            active: Mutex::new(HashMap::new()),
            requester: Mutex::new(None),
        })
    }

    /// The production state, rooted at the shared models directory.
    pub fn shared_default() -> SharedLocalModelState {
        let root = models_root().unwrap_or_else(|| PathBuf::from("models"));
        Self::new(root, DEFAULT_BASE_URL.to_string())
    }

    pub fn set_requester(&self, requester: Arc<LocalModelRequester>) {
        *self.requester.lock().unwrap() = Some(requester);
    }

    pub fn requester(&self) -> Option<Arc<LocalModelRequester>> {
        self.requester.lock().unwrap().clone()
    }

    pub fn is_downloading(&self, id: &str) -> bool {
        self.active.lock().unwrap().contains_key(id)
    }

    pub fn received_bytes(&self, id: &str) -> Option<u64> {
        self.active
            .lock()
            .unwrap()
            .get(id)
            .map(|d| d.received.load(Ordering::Relaxed))
    }

    /// Cancel every in-flight download.
    pub fn cancel_all(&self) {
        for download in self.active.lock().unwrap().values() {
            download.cancel.cancel();
        }
    }

    fn begin(&self, id: &str) -> Option<(CancellationToken, Arc<AtomicU64>)> {
        let mut active = self.active.lock().unwrap();
        if active.contains_key(id) {
            return None;
        }
        let cancel = CancellationToken::new();
        let received = Arc::new(AtomicU64::new(0));
        active.insert(
            id.to_string(),
            ActiveDownload {
                cancel: cancel.clone(),
                received: Arc::clone(&received),
            },
        );
        Some((cancel, received))
    }

    fn finish(&self, id: &str) {
        self.active.lock().unwrap().remove(id);
    }
}

#[derive(Debug)]
pub enum DownloadOutcome {
    /// Already present at the catalog's revision — nothing was fetched.
    AlreadyInstalled,
    Installed,
    Cancelled,
    Failed(String),
}

/// Fetch and verify a whole pack, then stamp it.
///
/// Files land in `.staging/<id>/<name>.part` and are only moved into place
/// once every one of them has matched its catalog digest — so an interrupted
/// download can never leave a directory that reads as installed, and a resumed
/// one picks up from the bytes already on disk.
pub async fn download_model(
    state: &SharedLocalModelState,
    entry: &'static CatalogEntry,
    rank: usize,
    cancel: CancellationToken,
    received_total: Arc<AtomicU64>,
    mut on_progress: impl FnMut(DownloadProgress),
) -> DownloadOutcome {
    let root = state.root.clone();
    let lock = match acquire_download_lock(&root, entry.id) {
        Ok(lock) => lock,
        Err(e) => return DownloadOutcome::Failed(e.to_string()),
    };

    // Another instance may have finished while we waited for the lock.
    if is_installed(&root, entry) {
        drop(lock);
        return DownloadOutcome::AlreadyInstalled;
    }

    let staging = staging_dir(&root).join(entry.id);
    if let Err(e) = fs::create_dir_all(&staging) {
        return DownloadOutcome::Failed(format!("{e}"));
    }

    let client = match reqwest::Client::builder().build() {
        Ok(client) => client,
        Err(e) => return DownloadOutcome::Failed(format!("{e}")),
    };

    // Bytes already on disk from an earlier run count toward the total, so a
    // resumed download reports where it actually is rather than restarting the
    // progress bar at zero.
    let mut completed_bytes: u64 = 0;
    let mut last_progress = Instant::now() - PROGRESS_INTERVAL;

    for (index, file) in entry.files.iter().enumerate() {
        let part = staging.join(format!("{}.part", file.name));
        let mut attempt = 0;
        loop {
            if cancel.is_cancelled() {
                return DownloadOutcome::Cancelled;
            }
            attempt += 1;
            let result = fetch_one(
                &client,
                &entry.file_url(&state.base_url, file),
                &part,
                file,
                &cancel,
                &received_total,
                completed_bytes,
                &mut |received| {
                    if last_progress.elapsed() >= PROGRESS_INTERVAL {
                        last_progress = Instant::now();
                        on_progress(DownloadProgress {
                            model: entry.id,
                            file: file.name,
                            file_index: index,
                            file_count: entry.files.len(),
                            received_bytes: received,
                            total_bytes: entry.total_bytes,
                        });
                    }
                },
            )
            .await;

            match result {
                Ok(()) => break,
                Err(FetchError::Cancelled) => return DownloadOutcome::Cancelled,
                Err(FetchError::Corrupt) => {
                    // A digest mismatch means the bytes on disk are wrong, not
                    // incomplete — resuming from them would re-fail forever.
                    let _ = fs::remove_file(&part);
                    if attempt >= FILE_ATTEMPTS {
                        return DownloadOutcome::Failed(format!(
                            "{} failed checksum verification",
                            file.name
                        ));
                    }
                }
                Err(FetchError::Io(message)) => {
                    if attempt >= FILE_ATTEMPTS {
                        return DownloadOutcome::Failed(message);
                    }
                    tokio::time::sleep(Duration::from_millis(400 * attempt as u64)).await;
                }
            }
        }
        completed_bytes += file.bytes;
        received_total.store(completed_bytes, Ordering::Relaxed);
    }

    // Everything verified: publish the pack, then stamp it.
    let dir = model_dir(&root, entry.id);
    if let Err(e) = fs::create_dir_all(&dir) {
        return DownloadOutcome::Failed(format!("{e}"));
    }
    for file in entry.files {
        let part = staging.join(format!("{}.part", file.name));
        if let Err(e) = fs::rename(&part, dir.join(file.name)) {
            return DownloadOutcome::Failed(format!("{e}"));
        }
    }
    if let Err(e) = write_stamp(&root, entry, rank) {
        return DownloadOutcome::Failed(format!("{e}"));
    }
    let _ = fs::remove_dir_all(&staging);
    drop(lock);
    DownloadOutcome::Installed
}

/// One progress observation, aggregated across the whole pack.
#[derive(Debug, Clone, Copy)]
pub struct DownloadProgress {
    pub model: &'static str,
    pub file: &'static str,
    pub file_index: usize,
    pub file_count: usize,
    pub received_bytes: u64,
    pub total_bytes: u64,
}

enum FetchError {
    Cancelled,
    Corrupt,
    Io(String),
}

/// Fetch one file into `part`, resuming from whatever is already there, and
/// verify it against the catalog digest.
#[allow(clippy::too_many_arguments)]
async fn fetch_one(
    client: &reqwest::Client,
    url: &str,
    part: &Path,
    file: &ModelFile,
    cancel: &CancellationToken,
    received_total: &Arc<AtomicU64>,
    base_bytes: u64,
    on_bytes: &mut impl FnMut(u64),
) -> Result<(), FetchError> {
    use futures::StreamExt;
    use std::io::Write;

    let mut have = fs::metadata(part).map(|m| m.len()).unwrap_or(0);
    if have > file.bytes {
        // Longer than the catalog says: not a resumable prefix.
        let _ = fs::remove_file(part);
        have = 0;
    }
    if have < file.bytes {
        let mut request = client.get(url);
        if have > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        let response = request
            .send()
            .await
            .map_err(|e| FetchError::Io(format!("{e}")))?;
        if !response.status().is_success() {
            return Err(FetchError::Io(format!(
                "{} returned HTTP {}",
                file.name,
                response.status()
            )));
        }
        // A server that ignores Range answers 200 with the whole body; start
        // the file over rather than appending a second copy.
        let append = have > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        if have > 0 && !append {
            have = 0;
        }
        let mut sink = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(append)
            .truncate(!append)
            .open(part)
            .map_err(|e| FetchError::Io(format!("{e}")))?;

        let mut written = have;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            if cancel.is_cancelled() {
                let _ = sink.flush();
                return Err(FetchError::Cancelled);
            }
            let chunk = chunk.map_err(|e| FetchError::Io(format!("{e}")))?;
            sink.write_all(&chunk)
                .map_err(|e| FetchError::Io(format!("{e}")))?;
            written += chunk.len() as u64;
            received_total.store(base_bytes + written, Ordering::Relaxed);
            on_bytes(base_bytes + written);
        }
        sink.flush().map_err(|e| FetchError::Io(format!("{e}")))?;
    }

    match verify_file(part, file.sha256) {
        Ok(true) => Ok(()),
        Ok(false) => Err(FetchError::Corrupt),
        Err(e) => Err(FetchError::Io(format!("{e}"))),
    }
}

// MARK: - Task requests to the Swift service

/// How long a task request waits for the app before giving up.
///
/// Per task, because the tasks sit in different places. `classify` is on a
/// person's critical path — it runs between Return and the line going
/// somewhere — so its ceiling is the point past which waiting is worse than
/// guessing Claude. `summarize` runs on a background cadence with nobody
/// waiting, but a headline that arrives late is still a headline nobody wanted,
/// so it gets a performance budget of its own rather than riding the transport
/// deadline.
///
/// `CLASSIFY_TIMEOUT` is one of **three** constants that must agree:
/// `LOCAL_MODEL_TIMEOUT_MS` in `tugdeck/src/lib/local-model-bridge.ts` and
/// `VERDICT_SUBMIT_WAIT_MS` in `tugdeck/src/components/tugways/tug-prompt-entry.tsx`
/// are the same 2s from the deck's side. Lowering one silently makes it the
/// real deadline and the other two unreachable.
const CLASSIFY_TIMEOUT: Duration = Duration::from_secs(2);
const SUMMARIZE_TIMEOUT: Duration = Duration::from_secs(6);

/// The transport deadline, and the fallback ceiling for any task without its
/// own. This is not a performance budget: it is the point past which the app is
/// presumed not to be answering at all.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Turnaround past which a task is worth a second look. Nothing is cancelled
/// here — these only mark a line `slow=true` so accumulated logs can be read
/// for drift. Provisional, to be set from real data.
const CLASSIFY_SLOW: Duration = Duration::from_secs(1);
const SUMMARIZE_SLOW: Duration = Duration::from_secs(3);

/// What the app answered for one request.
#[derive(Debug, Clone)]
pub struct LocalModelReply {
    pub ok: bool,
    pub text: Option<String>,
    pub error: Option<String>,
}

/// Sends task requests up the control socket and matches replies to them.
///
/// tugcast can't run a model itself — the runtime lives in Tug.app, on the
/// other end of the socket. This is the whole of tugcast's side of that
/// conversation: write a request with an id, park a oneshot under it, and let
/// the recv loop resolve it when the reply comes back.
pub struct LocalModelRequester {
    tx: mpsc::Sender<String>,
    pending: Mutex<HashMap<String, oneshot::Sender<LocalModelReply>>>,
    next_id: AtomicU64,
}

impl LocalModelRequester {
    pub fn new(tx: mpsc::Sender<String>) -> Arc<Self> {
        Arc::new(Self {
            tx,
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        })
    }

    /// Route a reply to whoever is waiting for it. Unknown ids — a reply that
    /// arrived after its request timed out — are dropped.
    pub fn resolve(&self, id: &str, reply: LocalModelReply) {
        let waiting = self.pending.lock().unwrap().remove(id);
        if let Some(waiting) = waiting {
            let _ = waiting.send(reply);
        }
    }

    pub async fn summarize(&self, prompt: String) -> Result<String, String> {
        self.request("summarize", prompt, None).await
    }

    /// Ask the model whether one line means the shell or means Claude.
    ///
    /// The deck asks this over its own WebKit bridge; this is the same
    /// question reachable from the socket, so the verdict can be observed
    /// without a composer in the loop.
    pub async fn classify(&self, text: String) -> Result<String, String> {
        self.request("classify", text, None).await
    }

    /// The ceiling and the slow threshold for one task, in one place, so a
    /// caller can never pair a task with bounds meant for another.
    fn bounds(task: &str) -> (Duration, Option<Duration>) {
        match task {
            "classify" => (CLASSIFY_TIMEOUT, Some(CLASSIFY_SLOW)),
            "summarize" => (SUMMARIZE_TIMEOUT, Some(SUMMARIZE_SLOW)),
            _ => (REQUEST_TIMEOUT, None),
        }
    }

    async fn request(
        &self,
        task: &str,
        prompt: String,
        max_tokens: Option<u32>,
    ) -> Result<String, String> {
        let (timeout, _) = Self::bounds(task);
        let id = format!("lm-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let body = serde_json::json!({
            "type": "local_model_request",
            "v": 1,
            "id": id,
            "task": task,
            "prompt": prompt,
            "max_tokens": max_tokens,
        });
        let line = serde_json::to_string(&body).map_err(|e| format!("{e}"))?;

        let (reply_tx, reply_rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id.clone(), reply_tx);

        let started = Instant::now();
        if self.tx.send(line).await.is_err() {
            self.pending.lock().unwrap().remove(&id);
            Self::record(task, "unavailable", started);
            return Err("local model host unavailable".to_string());
        }

        match tokio::time::timeout(timeout, reply_rx).await {
            Ok(Ok(reply)) if reply.ok => {
                Self::record(task, "ok", started);
                Ok(reply.text.unwrap_or_default())
            }
            Ok(Ok(reply)) => {
                Self::record(task, "refused", started);
                Err(reply.error.unwrap_or_else(|| "unavailable".to_string()))
            }
            Ok(Err(_)) => {
                Self::record(task, "dropped", started);
                Err("local model request dropped".to_string())
            }
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Self::record(task, "timed_out", started);
                Err("local model request timed out".to_string())
            }
        }
    }

    /// The caller's side of one request.
    ///
    /// The service's own line says what inference cost; this says what the
    /// caller waited for and whether it gave up. Neither can see the other's
    /// fact — a timeout is invisible to the service, which finishes eventually
    /// and never learns nobody was still listening — and the gap between the
    /// two durations is the transport and queueing cost.
    fn record(task: &str, outcome: &str, started: Instant) {
        let elapsed = started.elapsed();
        let slow = Self::bounds(task)
            .1
            .is_some_and(|threshold| elapsed > threshold);
        let elapsed_ms = elapsed.as_millis() as u64;
        // Display-formatted rather than debug-formatted so the values land
        // unquoted, which is the shape the app's own lines carry and what lets
        // one regex read both files.
        if slow {
            info!(
                task = %task,
                outcome = %outcome,
                elapsed_ms,
                slow = true,
                "local model call",
            );
        } else {
            info!(task = %task, outcome = %outcome, elapsed_ms, "local model call");
        }
    }
}

// MARK: - CONTROL verbs

/// Publish the whole inventory: what the catalog knows, and what state each
/// entry is in on this machine.
///
/// Broadcast as the answer to `local_model_list` and, unsolicited, on every
/// state change — so a deck that missed a result frame still converges.
pub fn broadcast_inventory(state: &SharedLocalModelState, cat: Option<&broadcast::Sender<Frame>>) {
    let Some(cat) = cat else { return };
    let models: Vec<serde_json::Value> = CATALOG
        .iter()
        .map(|entry| {
            let downloading = state.is_downloading(entry.id);
            let installed = is_installed(&state.root, entry);
            let status = if installed {
                "installed"
            } else if downloading {
                "downloading"
            } else {
                "available"
            };
            serde_json::json!({
                "id": entry.id,
                "displayName": entry.display_name,
                "recommended": entry.recommended,
                "offered": entry.offered,
                "totalBytes": entry.total_bytes,
                "state": status,
                "notes": entry.notes,
                "receivedBytes": state.received_bytes(entry.id),
            })
        })
        .collect();
    send_control(
        cat,
        serde_json::json!({ "action": "local_model_inventory", "models": models }),
    );
}

fn send_control(cat: &broadcast::Sender<Frame>, body: serde_json::Value) {
    if let Ok(bytes) = serde_json::to_vec(&body) {
        let _ = cat.send(Frame::new(FeedId::CONTROL, bytes));
    }
}

fn broadcast_result(
    cat: Option<&broadcast::Sender<Frame>>,
    model: &str,
    ok: bool,
    error: Option<String>,
) {
    broadcast_outcome(cat, model, ok, false, error);
}

/// Report a download the user stopped. A cancel is not a failure, so it
/// carries its own flag rather than an error string the deck would have to
/// recognize by its wording.
fn broadcast_canceled(cat: Option<&broadcast::Sender<Frame>>, model: &str) {
    broadcast_outcome(cat, model, false, true, None);
}

fn broadcast_outcome(
    cat: Option<&broadcast::Sender<Frame>>,
    model: &str,
    ok: bool,
    canceled: bool,
    error: Option<String>,
) {
    let Some(cat) = cat else { return };
    send_control(
        cat,
        serde_json::json!({
            "action": "local_model_download_result",
            "model": model,
            "ok": ok,
            "canceled": canceled,
            "error": error,
        }),
    );
}

/// Acquire a model, or report why it wasn't acquired.
///
/// Idempotent by design: an installed model answers ok immediately and a model
/// already downloading is a no-op, so a retried CTA can never start a second
/// fetch of the same pack.
pub fn start_download(
    state: &SharedLocalModelState,
    cat: Option<broadcast::Sender<Frame>>,
    id: &str,
) {
    let Some((rank, entry)) = catalog_entry(id) else {
        broadcast_result(cat.as_ref(), id, false, Some("unknown model".to_string()));
        return;
    };
    if is_installed(&state.root, entry) {
        broadcast_result(cat.as_ref(), id, true, None);
        broadcast_inventory(state, cat.as_ref());
        return;
    }
    let Some((cancel, received)) = state.begin(id) else {
        return;
    };
    broadcast_inventory(state, cat.as_ref());

    let state = Arc::clone(state);
    tokio::spawn(async move {
        let progress_cat = cat.clone();
        let outcome = download_model(&state, entry, rank, cancel, received, move |progress| {
            if let Some(cat) = progress_cat.as_ref() {
                send_control(
                    cat,
                    serde_json::json!({
                        "action": "local_model_download_progress",
                        "model": progress.model,
                        "file": progress.file,
                        "fileIndex": progress.file_index,
                        "fileCount": progress.file_count,
                        "receivedBytes": progress.received_bytes,
                        "totalBytes": progress.total_bytes,
                    }),
                );
            }
        })
        .await;
        state.finish(entry.id);
        match outcome {
            DownloadOutcome::Installed | DownloadOutcome::AlreadyInstalled => {
                info!(model = entry.id, "local model installed");
                broadcast_result(cat.as_ref(), entry.id, true, None);
            }
            DownloadOutcome::Cancelled => {
                info!(model = entry.id, "local model download canceled");
                broadcast_canceled(cat.as_ref(), entry.id);
            }
            DownloadOutcome::Failed(error) => {
                warn!(model = entry.id, %error, "local model download failed");
                broadcast_result(cat.as_ref(), entry.id, false, Some(error));
            }
        }
        broadcast_inventory(&state, cat.as_ref());
    });
}

/// Run one summarize task through the app and broadcast the answer.
///
/// This is tugcast's own use of the local-model API — the same round trip the
/// overview emitter makes, reachable as a verb so the socket path can be
/// exercised and diagnosed without a tenant attached to it.
///
/// The answer is normalized through `headline_register` before it is reported,
/// exactly as the emitter normalizes it, so what this verb prints is what the
/// strip would wear. The raw answer rides alongside it: the two differing is the
/// signal that the prompt is drifting and the normalizer is covering for it.
pub fn request_summary(
    state: &SharedLocalModelState,
    cat: Option<broadcast::Sender<Frame>>,
    prompt: String,
) {
    let requester = state.requester();
    tokio::spawn(async move {
        let result = match requester {
            Some(requester) => requester.summarize(prompt).await,
            None => Err("local model host unavailable".to_string()),
        };
        let (ok, text, error) = match result {
            Ok(raw) => {
                let report = crate::feeds::session_overview::headline_register_report(&raw);
                info!(
                    %raw,
                    headline = %report.text,
                    normalized = report.normalized,
                    trimmed = report.trimmed,
                    clipped = report.clipped,
                    "local model summarize answered",
                );
                (true, Some(report.text), None)
            }
            Err(error) => {
                warn!(%error, "local model summarize failed");
                (false, None, Some(error))
            }
        };
        let Some(cat) = cat else { return };
        send_control(
            &cat,
            serde_json::json!({
                "action": "local_model_summarize_result",
                "ok": ok,
                "text": text,
                "error": error,
            }),
        );
    });
}

/// Run one classify task through the app and broadcast the verdict.
///
/// The shell-routing tenant asks this question on every ambiguous line, but it
/// asks over the deck's WebKit bridge, where the answer is invisible from
/// outside. This is the same question on the socket, so what the model actually
/// says about a given line can be read directly.
pub fn request_classification(
    state: &SharedLocalModelState,
    cat: Option<broadcast::Sender<Frame>>,
    text: String,
) {
    let requester = state.requester();
    tokio::spawn(async move {
        let result = match requester {
            Some(requester) => requester.classify(text.clone()).await,
            None => Err("local model host unavailable".to_string()),
        };
        // No elapsed here: `local model call` already timed this request from
        // the caller's side, and two timings of one request invite the reader
        // to wonder which is authoritative.
        let (ok, verdict, error) = match result {
            Ok(verdict) => {
                info!(%text, %verdict, "local model classify answered");
                (true, Some(verdict), None)
            }
            Err(error) => {
                warn!(%text, %error, "local model classify failed");
                (false, None, Some(error))
            }
        };
        let Some(cat) = cat else { return };
        send_control(
            &cat,
            serde_json::json!({
                "action": "local_model_classify_result",
                "ok": ok,
                "verdict": verdict,
                "error": error,
            }),
        );
    });
}

/// Remove an installed model.
///
/// Refused while that model is downloading — the staging files are the other
/// task's. A model the Swift service currently holds resident is fine to
/// delete: unlinking mmap'd weights is safe, and the service re-reads the
/// store per request, so it stops answering with the deleted model on the
/// next one.
pub fn delete_model(
    state: &SharedLocalModelState,
    cat: Option<broadcast::Sender<Frame>>,
    id: &str,
) {
    if state.is_downloading(id) {
        broadcast_result(
            cat.as_ref(),
            id,
            false,
            Some("cannot delete while downloading".to_string()),
        );
        return;
    }
    match remove_model(&state.root, id) {
        Ok(()) => info!(model = id, "local model deleted"),
        Err(e) => {
            warn!(model = id, error = %e, "local model delete failed");
            broadcast_result(cat.as_ref(), id, false, Some(format!("{e}")));
            return;
        }
    }
    broadcast_inventory(state, cat.as_ref());
}

/// Resume an interrupted acquisition at startup.
///
/// A user who picked a model and then quit mid-download shouldn't have to ask
/// again: if the selection names a catalog entry that isn't installed, the
/// download simply continues from the `.part` files already on disk.
pub fn resume_selected_download(
    state: &SharedLocalModelState,
    cat: Option<broadcast::Sender<Frame>>,
    selection: &str,
) {
    if selection == MODEL_AUTO || selection == MODEL_DECLINED {
        return;
    }
    let Some((_, entry)) = catalog_entry(selection) else {
        return;
    };
    if is_installed(&state.root, entry) || state.is_downloading(selection) {
        return;
    }
    info!(model = selection, "resuming local model download");
    start_download(state, cat, selection);
}

// MARK: - Configuration

/// Tugbank domain for on-device inference. Mirrored in
/// `tugapp/Sources/LocalModelService.swift` and
/// `tugdeck/src/lib/local-model-store.ts`.
pub const LOCAL_MODEL_DOMAIN: &str = "dev.tugtool.local-model";
/// `Value::String`: a catalog id, `"auto"`, or `""` (declined). Absent reads
/// as `"auto"`.
pub const MODEL_KEY: &str = "model";
pub const MODEL_AUTO: &str = "auto";
pub const MODEL_DECLINED: &str = "";

/// Per-tenant kill switch for the session-overview line. `Value::Bool`; absent
/// reads as enabled, the repo's kill-switch convention ([Q05]).
///
/// The shell-routing switch under the same domain has no Rust consumer — that
/// tenant lives entirely in the deck — so its key is declared only in
/// `local-model-store.ts`.
pub const PULSE_OVERVIEW_KEY: &str = "pulse-overview";

/// Read a tenant kill switch. Absent — and any non-bool — reads as enabled, so
/// a tenant is never accidentally dark because a value was never written.
pub fn tenant_enabled(bank: Option<&tugbank_core::TugbankClient>, key: &str) -> bool {
    let Some(bank) = bank else {
        return true;
    };
    match bank.get(LOCAL_MODEL_DOMAIN, key) {
        Ok(Some(tugbank_core::Value::Bool(enabled))) => enabled,
        _ => true,
    }
}

/// Read the model selection, applying the absent-reads-as-`auto` rule.
pub fn selected_model(bank: Option<&tugbank_core::TugbankClient>) -> String {
    let Some(bank) = bank else {
        return MODEL_AUTO.to_string();
    };
    match bank.get(LOCAL_MODEL_DOMAIN, MODEL_KEY) {
        Ok(Some(tugbank_core::Value::String(value))) => value,
        _ => MODEL_AUTO.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_root() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tugcast-local-model-test-{}-{:?}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Lay down files matching a catalog entry's byte sizes (contents are
    /// irrelevant to `is_installed`, which checks sizes, not digests).
    fn place_files(root: &Path, entry: &CatalogEntry) {
        let dir = model_dir(root, entry.id);
        fs::create_dir_all(&dir).unwrap();
        for file in entry.files {
            let mut f = fs::File::create(dir.join(file.name)).unwrap();
            f.write_all(&vec![0u8; file.bytes as usize]).unwrap();
        }
    }

    /// A stand-in entry with small files, so the size checks don't require
    /// materializing gigabytes.
    const TEST_ENTRY: CatalogEntry = CatalogEntry {
        id: "test-pack",
        display_name: "Test Pack",
        recommended: false,
        offered: false,
        hf_repo: "example/test-pack",
        hf_revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        files: &[
            ModelFile {
                name: "config.json",
                // sha256 of 8 zero bytes
                sha256: "af5570f5a1810b7af78caf4bc70a660f0df51e42baf91d4de5b2328de0e83dfc",
                bytes: 8,
            },
            ModelFile {
                name: "weights.safetensors",
                // sha256 of 16 zero bytes
                sha256: "374708fff7719dd5979ec875d56cd2286f6d3cf7ec317a3b25632aab28ec37bb",
                bytes: 16,
            },
        ],
        total_bytes: 24,
        context_window: 4096,
        notes: "",
    };

    #[test]
    fn catalog_is_internally_consistent() {
        for entry in CATALOG {
            let sum: u64 = entry.files.iter().map(|f| f.bytes).sum();
            assert_eq!(sum, entry.total_bytes, "{} total_bytes", entry.id);
            assert_eq!(entry.hf_revision.len(), 40, "{} revision", entry.id);
            for file in entry.files {
                assert_eq!(file.sha256.len(), 64, "{} {}", entry.id, file.name);
            }
            if entry.recommended {
                assert!(entry.offered, "{} recommended but not offered", entry.id);
            }
        }
        assert_eq!(
            CATALOG.iter().filter(|e| e.recommended).count(),
            1,
            "exactly one recommended entry"
        );
        // One pack ships. Two multi-gigabyte downloads is not a configuration
        // this app asks anyone to accept, so a second `offered` entry is a
        // mistake rather than a choice.
        assert_eq!(
            CATALOG.iter().filter(|e| e.offered).count(),
            1,
            "exactly one offered entry"
        );
        // `auto` resolves by position, so the shipping pack has to be first or
        // a user on `auto` who holds two packs gets the retired one.
        assert!(CATALOG[0].recommended, "the recommended entry ranks first");
    }

    /// The transition a real user lands in: they installed the old recommended
    /// pack, the catalog was reordered under them, and `auto` must follow the
    /// catalog rather than their install order.
    ///
    /// `resolveRoute`'s `auto` branch takes `installed().first`, sorted by the
    /// rank recorded in each pack's stamp — so without the reconcile they keep
    /// being routed to the retired pack indefinitely.
    #[test]
    fn a_reordered_catalog_reranks_packs_already_on_disk() {
        let root = temp_root();
        // Stamp both shipping packs with the ranks they had before the ruling:
        // the incumbent first, the winner behind it.
        let (winner_rank, winner) = catalog_entry("qwen3-4b-instruct-2507-4bit").unwrap();
        let (retired_rank, retired) = catalog_entry("ternary-bonsai-8b-2bit").unwrap();
        assert_eq!(winner_rank, 0, "the winner ranks first in the catalog");
        write_stamp(&root, retired, 0).unwrap();
        write_stamp(&root, winner, 1).unwrap();

        assert_eq!(reconcile_catalog_ranks(&root), 2, "both stamps were stale");
        assert_eq!(read_stamp(&root, winner.id).unwrap().catalog_rank, winner_rank);
        assert_eq!(read_stamp(&root, retired.id).unwrap().catalog_rank, retired_rank);

        // Idempotent, and it never touches what a verification established.
        let before = read_stamp(&root, winner.id).unwrap();
        assert_eq!(reconcile_catalog_ranks(&root), 0);
        let after = read_stamp(&root, winner.id).unwrap();
        assert_eq!(before.hf_revision, after.hf_revision);
        assert_eq!(before.verified_at, after.verified_at);
        assert_eq!(before.files.len(), after.files.len());

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn file_url_pins_the_revision() {
        let (_, entry) = catalog_entry("ternary-bonsai-8b-2bit").unwrap();
        let url = entry.file_url(DEFAULT_BASE_URL, &entry.files[1]);
        assert_eq!(
            url,
            "https://huggingface.co/prism-ml/Ternary-Bonsai-8B-mlx-2bit/resolve/9260b24298e4211e804663e9f519962cf59f34be/config.json"
        );
    }

    #[test]
    fn stamp_round_trips() {
        let root = temp_root();
        let written = write_stamp(&root, &TEST_ENTRY, 3).unwrap();
        let read = read_stamp(&root, TEST_ENTRY.id).unwrap();
        assert_eq!(written, read);
        assert_eq!(read.catalog_rank, 3);
        assert_eq!(read.backend, "mlx");
        assert_eq!(read.files.len(), 2);
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn is_installed_requires_stamp_and_files() {
        let root = temp_root();
        assert!(!is_installed(&root, &TEST_ENTRY), "empty root");

        place_files(&root, &TEST_ENTRY);
        assert!(!is_installed(&root, &TEST_ENTRY), "files without a stamp");

        write_stamp(&root, &TEST_ENTRY, 0).unwrap();
        assert!(is_installed(&root, &TEST_ENTRY), "stamped and complete");

        fs::remove_file(model_dir(&root, TEST_ENTRY.id).join("weights.safetensors")).unwrap();
        assert!(
            !is_installed(&root, &TEST_ENTRY),
            "stamped but a file is gone"
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn is_installed_rejects_a_revision_mismatch() {
        let root = temp_root();
        place_files(&root, &TEST_ENTRY);
        write_stamp(&root, &TEST_ENTRY, 0).unwrap();

        let mut bumped = TEST_ENTRY;
        bumped.hf_revision = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        assert!(
            !is_installed(&root, &bumped),
            "old stamp for a new revision"
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn is_installed_rejects_a_truncated_file() {
        let root = temp_root();
        place_files(&root, &TEST_ENTRY);
        write_stamp(&root, &TEST_ENTRY, 0).unwrap();
        fs::write(
            model_dir(&root, TEST_ENTRY.id).join("config.json"),
            b"short",
        )
        .unwrap();
        assert!(!is_installed(&root, &TEST_ENTRY));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn verify_file_accepts_and_rejects() {
        let root = temp_root();
        let path = root.join("payload");
        fs::write(&path, b"hello local model").unwrap();
        let digest = {
            let mut hasher = Sha256::new();
            hasher.update(b"hello local model");
            hex_lower(&hasher.finalize())
        };
        assert!(verify_file(&path, &digest).unwrap());
        assert!(!verify_file(&path, &"0".repeat(64)).unwrap());

        fs::write(&path, b"hello local modeL").unwrap();
        assert!(!verify_file(&path, &digest).unwrap(), "one flipped byte");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn remove_model_clears_the_stamp() {
        let root = temp_root();
        place_files(&root, &TEST_ENTRY);
        write_stamp(&root, &TEST_ENTRY, 0).unwrap();
        remove_model(&root, TEST_ENTRY.id).unwrap();
        assert!(read_stamp(&root, TEST_ENTRY.id).is_none());
        assert!(remove_model(&root, TEST_ENTRY.id).is_ok(), "idempotent");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn config_defaults_apply_without_a_bank() {
        assert_eq!(selected_model(None), MODEL_AUTO);
    }

    // MARK: Task requests

    /// The bounds only mean anything in this order. A slow threshold at or
    /// above its own ceiling can never fire; a summarize ceiling above the
    /// emitter's floor would make the cadence inference-bound.
    #[test]
    fn the_turnaround_bounds_are_ordered() {
        assert!(CLASSIFY_SLOW < CLASSIFY_TIMEOUT);
        assert!(CLASSIFY_TIMEOUT < SUMMARIZE_SLOW);
        assert!(SUMMARIZE_SLOW < SUMMARIZE_TIMEOUT);
        assert!(SUMMARIZE_TIMEOUT < REQUEST_TIMEOUT);
        assert!(SUMMARIZE_TIMEOUT < crate::feeds::session_overview::EMIT_FLOOR);
    }

    /// The point of giving summarize its own ceiling: it gives up at six
    /// seconds rather than riding the ten-second transport deadline.
    #[tokio::test(start_paused = true)]
    async fn a_summarize_nobody_answers_gives_up_at_its_own_ceiling() {
        // `_rx` is held so the send succeeds and the request really parks on
        // its reply channel; dropping it would fail the send instead.
        let (tx, _rx) = mpsc::channel::<String>(4);
        let requester = LocalModelRequester::new(tx);

        let started = tokio::time::Instant::now();
        let error = requester.summarize("digest".to_string()).await.unwrap_err();
        let waited = started.elapsed();

        assert!(error.contains("timed out"), "{error}");
        assert!(waited >= SUMMARIZE_TIMEOUT, "{waited:?}");
        assert!(waited < REQUEST_TIMEOUT, "{waited:?}");
    }

    #[tokio::test]
    async fn a_request_resolves_when_its_reply_arrives() {
        let (tx, mut rx) = mpsc::channel::<String>(4);
        let requester = LocalModelRequester::new(tx);

        let answering = Arc::clone(&requester);
        tokio::spawn(async move {
            let line = rx.recv().await.unwrap();
            let sent: serde_json::Value = serde_json::from_str(&line).unwrap();
            assert_eq!(sent["type"], "local_model_request");
            assert_eq!(sent["task"], "summarize");
            assert_eq!(sent["v"], 1);
            let id = sent["id"].as_str().unwrap().to_string();
            answering.resolve(
                &id,
                LocalModelReply {
                    ok: true,
                    text: Some("wiring up the local model".to_string()),
                    error: None,
                },
            );
        });

        let answer = requester.summarize("digest".to_string()).await.unwrap();
        assert_eq!(answer, "wiring up the local model");
    }

    #[tokio::test]
    async fn a_failed_reply_surfaces_its_error() {
        let (tx, mut rx) = mpsc::channel::<String>(4);
        let requester = LocalModelRequester::new(tx);
        let answering = Arc::clone(&requester);
        tokio::spawn(async move {
            let line = rx.recv().await.unwrap();
            let sent: serde_json::Value = serde_json::from_str(&line).unwrap();
            answering.resolve(
                sent["id"].as_str().unwrap(),
                LocalModelReply {
                    ok: false,
                    text: None,
                    error: Some("no local model installed".to_string()),
                },
            );
        });
        let error = requester.summarize("digest".to_string()).await.unwrap_err();
        assert_eq!(error, "no local model installed");
    }

    #[tokio::test(start_paused = true)]
    async fn a_request_times_out_and_stops_waiting() {
        let (tx, _rx) = mpsc::channel::<String>(4);
        let requester = LocalModelRequester::new(tx);
        let error = requester
            .request("summarize", "digest".to_string(), None)
            .await
            .unwrap_err();
        assert_eq!(error, "local model request timed out");
        assert!(
            requester.pending.lock().unwrap().is_empty(),
            "a timed-out request must not leak its slot"
        );
    }

    #[tokio::test]
    async fn a_reply_for_an_unknown_id_is_dropped() {
        let (tx, _rx) = mpsc::channel::<String>(4);
        let requester = LocalModelRequester::new(tx);
        requester.resolve(
            "lm-does-not-exist",
            LocalModelReply {
                ok: true,
                text: Some("late".to_string()),
                error: None,
            },
        );
    }

    // MARK: Downloader

    /// A two-file pack whose contents are small enough to serve inline.
    const SERVED: &[(&str, &[u8])] = &[
        ("config.json", b"bravo-config"),
        ("model.safetensors", b"alpha-weights-payload"),
    ];

    const SERVED_ENTRY: CatalogEntry = CatalogEntry {
        id: "served-pack",
        display_name: "Served Pack",
        recommended: false,
        offered: false,
        hf_repo: "example/served-pack",
        hf_revision: "cccccccccccccccccccccccccccccccccccccccc",
        files: &[
            ModelFile {
                name: "config.json",
                sha256: "64e138f65b65121dc45ce66537d4e8f8d010be49ab800e4972d71506f0905d4a",
                bytes: 12,
            },
            ModelFile {
                name: "model.safetensors",
                sha256: "a1e885f34e44dab7e2754bbef6ee881d791b777c7a48caceab52179662c709f2",
                bytes: 21,
            },
        ],
        total_bytes: 33,
        context_window: 1024,
        notes: "",
    };

    #[derive(Clone)]
    struct ServerState {
        /// Corrupt this file's bytes on the way out.
        corrupt: Option<String>,
        /// Trickle the body out so a cancel can land mid-stream.
        slow: bool,
        /// Range headers the server was asked for, in order.
        ranges: Arc<Mutex<Vec<String>>>,
    }

    /// Serve the pack over HTTP with real `Range` support, so resume is
    /// exercised against a server that behaves like the real one.
    async fn serve_pack(state: ServerState) -> String {
        use axum::extract::{Path as AxumPath, State};
        use axum::http::{HeaderMap, StatusCode};
        use axum::response::Response;
        use axum::routing::get;

        async fn handler(
            State(state): State<ServerState>,
            AxumPath(path): AxumPath<String>,
            headers: HeaderMap,
        ) -> Response {
            let name = path.rsplit('/').next().unwrap_or_default().to_string();
            let Some((_, body)) = SERVED.iter().find(|(n, _)| *n == name) else {
                return Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(axum::body::Body::empty())
                    .unwrap();
            };
            let mut bytes = body.to_vec();
            if state.corrupt.as_deref() == Some(name.as_str()) {
                bytes = b"totally different bytes".to_vec();
            }

            let range = headers
                .get(axum::http::header::RANGE)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);
            if let Some(range) = &range {
                state.ranges.lock().unwrap().push(format!("{name}:{range}"));
            }
            let start = range
                .as_deref()
                .and_then(|r| r.strip_prefix("bytes="))
                .and_then(|r| r.split('-').next())
                .and_then(|n| n.parse::<usize>().ok())
                .unwrap_or(0)
                .min(bytes.len());
            let slice = bytes[start..].to_vec();
            let status = if start > 0 {
                StatusCode::PARTIAL_CONTENT
            } else {
                StatusCode::OK
            };

            let body = if state.slow {
                let stream = futures::stream::unfold(slice.into_iter(), |mut it| async move {
                    let byte = it.next()?;
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    Some((
                        Ok::<_, std::io::Error>(axum::body::Bytes::from(vec![byte])),
                        it,
                    ))
                });
                axum::body::Body::from_stream(stream)
            } else {
                axum::body::Body::from(slice)
            };
            Response::builder().status(status).body(body).unwrap()
        }

        let app = get(handler).with_state(state);
        let router = axum::Router::new().route("/{*path}", app);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        format!("http://{addr}")
    }

    fn plain_server_state() -> ServerState {
        ServerState {
            corrupt: None,
            slow: false,
            ranges: Arc::new(Mutex::new(Vec::new())),
        }
    }

    async fn run_download(
        root: &Path,
        base_url: String,
        cancel: CancellationToken,
    ) -> (DownloadOutcome, Vec<DownloadProgress>, u64) {
        let state = LocalModelState::new(root.to_path_buf(), base_url);
        let received = Arc::new(AtomicU64::new(0));
        let mut seen = Vec::new();
        let outcome = download_model(
            &state,
            &SERVED_ENTRY,
            0,
            cancel,
            Arc::clone(&received),
            |p| seen.push(p),
        )
        .await;
        let total = received.load(Ordering::Relaxed);
        (outcome, seen, total)
    }

    #[tokio::test]
    async fn download_finalizes_and_stamps() {
        let root = temp_root();
        let base = serve_pack(plain_server_state()).await;
        let (outcome, progress, received) =
            run_download(&root, base, CancellationToken::new()).await;

        assert!(matches!(outcome, DownloadOutcome::Installed), "{outcome:?}");
        assert!(is_installed(&root, &SERVED_ENTRY));
        assert_eq!(received, SERVED_ENTRY.total_bytes);
        assert_eq!(
            fs::read(model_dir(&root, SERVED_ENTRY.id).join("config.json")).unwrap(),
            b"bravo-config"
        );
        for p in &progress {
            assert_eq!(p.total_bytes, SERVED_ENTRY.total_bytes, "pack-wide total");
        }
        // Staging is cleaned up, so nothing looks like an in-flight download.
        assert!(!staging_dir(&root).join(SERVED_ENTRY.id).exists());
        fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn download_resumes_from_a_partial_file() {
        let root = temp_root();
        let server = plain_server_state();
        let ranges = Arc::clone(&server.ranges);
        let base = serve_pack(server).await;

        // Leave behind the prefix an interrupted run would have written.
        let staging = staging_dir(&root).join(SERVED_ENTRY.id);
        fs::create_dir_all(&staging).unwrap();
        fs::write(staging.join("model.safetensors.part"), b"alpha-").unwrap();

        let (outcome, _, _) = run_download(&root, base, CancellationToken::new()).await;
        assert!(matches!(outcome, DownloadOutcome::Installed), "{outcome:?}");
        assert_eq!(
            fs::read(model_dir(&root, SERVED_ENTRY.id).join("model.safetensors")).unwrap(),
            b"alpha-weights-payload"
        );
        let asked = ranges.lock().unwrap().clone();
        assert!(
            asked.iter().any(|r| r == "model.safetensors:bytes=6-"),
            "expected a resume request, saw {asked:?}"
        );
        fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn download_rejects_a_bad_checksum() {
        let root = temp_root();
        let mut server = plain_server_state();
        server.corrupt = Some("config.json".to_string());
        let base = serve_pack(server).await;

        let (outcome, _, _) = run_download(&root, base, CancellationToken::new()).await;
        match outcome {
            DownloadOutcome::Failed(message) => assert!(message.contains("config.json")),
            other => panic!("expected a checksum failure, got {other:?}"),
        }
        assert!(!is_installed(&root, &SERVED_ENTRY));
        assert!(
            !staging_dir(&root)
                .join(SERVED_ENTRY.id)
                .join("config.json.part")
                .exists(),
            "corrupt staging must not survive to be resumed from"
        );
        fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn cancel_stops_the_download_but_keeps_the_partial() {
        let root = temp_root();
        let mut server = plain_server_state();
        server.slow = true;
        let base = serve_pack(server).await;

        let cancel = CancellationToken::new();
        let trigger = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(80)).await;
            trigger.cancel();
        });

        let (outcome, _, _) = run_download(&root, base, cancel).await;
        assert!(matches!(outcome, DownloadOutcome::Cancelled), "{outcome:?}");
        assert!(!is_installed(&root, &SERVED_ENTRY));
        let part = staging_dir(&root)
            .join(SERVED_ENTRY.id)
            .join("config.json.part");
        assert!(part.exists(), "cancel must leave staging resumable");
        fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn a_live_lock_owner_blocks_and_a_dead_one_is_reclaimed() {
        let root = temp_root();
        let held = acquire_download_lock(&root, "pack").unwrap();
        assert!(
            matches!(acquire_download_lock(&root, "pack"), Err(LockError::Busy)),
            "a live owner must not be displaced"
        );
        drop(held);

        // A crashed instance's lock names a pid that no longer exists.
        let lock_path = staging_dir(&root).join("pack.lock");
        fs::write(&lock_path, "999999").unwrap();
        let reclaimed = acquire_download_lock(&root, "pack");
        assert!(reclaimed.is_ok(), "a stale lock must be reclaimed");
        drop(reclaimed);
        assert!(!lock_path.exists(), "the guard removes the lock on drop");
        fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn a_stamp_that_appears_first_skips_the_download() {
        let root = temp_root();
        // Another instance finished while this one was waiting for the lock.
        let dir = model_dir(&root, SERVED_ENTRY.id);
        fs::create_dir_all(&dir).unwrap();
        for (name, body) in SERVED {
            fs::write(dir.join(name), body).unwrap();
        }
        write_stamp(&root, &SERVED_ENTRY, 0).unwrap();

        // An unreachable base URL proves nothing was fetched.
        let (outcome, _, _) = run_download(
            &root,
            "http://127.0.0.1:1".to_string(),
            CancellationToken::new(),
        )
        .await;
        assert!(
            matches!(outcome, DownloadOutcome::AlreadyInstalled),
            "{outcome:?}"
        );
        fs::remove_dir_all(&root).ok();
    }

    #[tokio::test]
    async fn delete_is_refused_while_downloading() {
        let root = temp_root();
        let dir = model_dir(&root, SERVED_ENTRY.id);
        fs::create_dir_all(&dir).unwrap();
        write_stamp(&root, &SERVED_ENTRY, 0).unwrap();

        let state = LocalModelState::new(root.clone(), DEFAULT_BASE_URL.to_string());
        let _in_flight = state.begin(SERVED_ENTRY.id).unwrap();
        delete_model(&state, None, SERVED_ENTRY.id);
        assert!(dir.exists(), "a download in flight owns the directory");

        state.finish(SERVED_ENTRY.id);
        delete_model(&state, None, SERVED_ENTRY.id);
        assert!(!dir.exists());
        fs::remove_dir_all(&root).ok();
    }
}
