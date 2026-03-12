//! Implementation of the `tugcode color` command
//!
//! Converts colors from various formats to TugColor notation.
//! Supports: hex (#RGB, #RRGGBB, #RRGGBBAA), rgb(), rgba(), hsl(), hsla(),
//! hsv(), oklch(), and CSS named colors.

use std::f64::consts::PI;

// Canonical palette data generated from palette-engine.ts at build time
mod palette_data {
    include!(concat!(env!("OUT_DIR"), "/color_palette_data.rs"));
}

// ---------------------------------------------------------------------------
// OKLCH ↔ linear sRGB conversion (matches palette-engine.ts exactly)
// ---------------------------------------------------------------------------

/// Convert OKLCH to linear sRGB. Matches palette-engine.ts oklchToLinearSRGB().
fn oklch_to_linear_srgb(l: f64, c: f64, h_deg: f64) -> (f64, f64, f64) {
    let h_rad = h_deg * PI / 180.0;
    let a = c * h_rad.cos();
    let b = c * h_rad.sin();

    let l_hat = l + 0.3963377774 * a + 0.2158037573 * b;
    let m_hat = l - 0.1055613458 * a - 0.0638541728 * b;
    let s_hat = l - 0.0894841775 * a - 1.2914855480 * b;

    let l_lms = l_hat * l_hat * l_hat;
    let m_lms = m_hat * m_hat * m_hat;
    let s_lms = s_hat * s_hat * s_hat;

    let r = 4.0767416621 * l_lms - 3.3077115913 * m_lms + 0.2309699292 * s_lms;
    let g = -1.2684380046 * l_lms + 2.6097574011 * m_lms - 0.3413193965 * s_lms;
    let bv = -0.0041960863 * l_lms - 0.7034186147 * m_lms + 1.7076147010 * s_lms;

    (r, g, bv)
}

// ---------------------------------------------------------------------------
// Linear sRGB → OKLCH conversion (forward direction)
// ---------------------------------------------------------------------------

/// Convert linear sRGB [0,1] to OKLCH (L, C, h_degrees).
fn linear_srgb_to_oklch(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    // Linear sRGB → LMS (published forward matrices from Ottosson)
    let l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    let m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    let s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

    // Cube root
    let l_hat = l.cbrt();
    let m_hat = m.cbrt();
    let s_hat = s.cbrt();

    // LMS^ → OKLab
    let ok_l = 0.2104542553 * l_hat + 0.7936177850 * m_hat - 0.0040720468 * s_hat;
    let ok_a = 1.9779984951 * l_hat - 2.4285922050 * m_hat + 0.4505937099 * s_hat;
    let ok_b = 0.0259040371 * l_hat + 0.7827717662 * m_hat - 0.8086757660 * s_hat;

    // OKLab → OKLCH
    let c = (ok_a * ok_a + ok_b * ok_b).sqrt();
    let h = if c < 1e-10 {
        0.0
    } else {
        let h_rad = ok_b.atan2(ok_a);
        let h_deg = h_rad * 180.0 / PI;
        if h_deg < 0.0 { h_deg + 360.0 } else { h_deg }
    };

    (ok_l, c, h)
}

// ---------------------------------------------------------------------------
// sRGB companding (gamma)
// ---------------------------------------------------------------------------

/// sRGB → linear (inverse companding)
fn srgb_to_linear(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// Linear → sRGB (forward companding)
fn linear_to_srgb(c: f64) -> f64 {
    if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

// ---------------------------------------------------------------------------
// oklch_to_tug_color — matches palette-engine.ts oklchToTugColor() exactly
// ---------------------------------------------------------------------------

struct TugColorResult {
    hue: String,
    intensity: i32,
    tone: i32,
}

fn oklch_to_tug_color(l: f64, c: f64, h: f64) -> TugColorResult {
    // Step 1: Find closest named hue
    let mut closest_hue = "";
    let mut closest_diff = f64::INFINITY;
    for &(name, angle) in palette_data::HUE_FAMILIES {
        let mut diff = (h - angle).abs();
        if diff > 180.0 {
            diff = 360.0 - diff;
        }
        if diff < closest_diff {
            closest_diff = diff;
            closest_hue = name;
        }
    }
    // Find the closest named hue angle for signed offset calculation
    let closest_angle = palette_data::HUE_FAMILIES
        .iter()
        .find(|&&(n, _)| n == closest_hue)
        .map(|&(_, a)| a)
        .unwrap_or(0.0);
    let mut signed_diff = h - closest_angle;
    if signed_diff > 180.0 {
        signed_diff -= 360.0;
    } else if signed_diff < -180.0 {
        signed_diff += 360.0;
    }
    let offset = signed_diff.round() as i32;
    let hue_name = if offset == 0 {
        closest_hue.to_string()
    } else {
        format!("{}{:+}", closest_hue, offset)
    };

    // Step 2: Get canonical L and peak chroma (always from named hue)
    let canonical_l = palette_data::DEFAULT_CANONICAL_L
        .iter()
        .find(|&&(n, _)| n == closest_hue)
        .map(|&(_, v)| v)
        .unwrap_or(0.77);
    let peak_c = palette_data::MAX_CHROMA_FOR_HUE
        .iter()
        .find(|&&(n, _)| n == closest_hue)
        .map(|&(_, v)| v)
        .unwrap_or(0.022)
        * palette_data::PEAK_C_SCALE;

    // Step 3: Invert tone from L
    let tone_raw = if l <= canonical_l {
        50.0 * (l - palette_data::L_DARK) / (canonical_l - palette_data::L_DARK)
    } else {
        50.0 + 50.0 * (l - canonical_l) / (palette_data::L_LIGHT - canonical_l)
    };
    let tone = tone_raw.clamp(0.0, 100.0).round() as i32;

    // Step 4: Invert intensity from C
    let intensity_raw = if peak_c > 0.0 {
        (c / peak_c) * 100.0
    } else {
        0.0
    };
    let intensity = intensity_raw.clamp(0.0, 100.0).round() as i32;

    TugColorResult {
        hue: hue_name,
        intensity,
        tone,
    }
}

// ---------------------------------------------------------------------------
// Color parsing — supports many input formats
// ---------------------------------------------------------------------------

/// Parsed color: OKLCH components plus optional alpha.
struct ParsedColor {
    l: f64,
    c: f64,
    h: f64,
    alpha: Option<f64>,
}

/// Parse a color string and return OKLCH components plus optional alpha.
/// Returns Err with a message if the format is not recognized.
fn parse_color(input: &str) -> Result<ParsedColor, String> {
    let s = input.trim();

    // oklch(L C h) or oklch(L C h / a)
    if let Some(lch) = try_parse_oklch(s) {
        return Ok(ParsedColor {
            l: lch.0,
            c: lch.1,
            h: lch.2,
            alpha: lch.3,
        });
    }

    // Hex: #RGB, #RRGGBB, #RRGGBBAA
    if let Some(rgb) = try_parse_hex(s) {
        let (r, g, b) = (
            srgb_to_linear(rgb.0),
            srgb_to_linear(rgb.1),
            srgb_to_linear(rgb.2),
        );
        let (l, c, h) = linear_srgb_to_oklch(r, g, b);
        return Ok(ParsedColor {
            l,
            c,
            h,
            alpha: rgb.3,
        });
    }

    // rgb(r, g, b) or rgba(r, g, b, a)
    if let Some(rgb) = try_parse_rgb(s) {
        let (r, g, b) = (
            srgb_to_linear(rgb.0),
            srgb_to_linear(rgb.1),
            srgb_to_linear(rgb.2),
        );
        let (l, c, h) = linear_srgb_to_oklch(r, g, b);
        return Ok(ParsedColor {
            l,
            c,
            h,
            alpha: rgb.3,
        });
    }

    // hsl(h, s%, l%) or hsla(h, s%, l%, a)
    if let Some(rgb) = try_parse_hsl(s) {
        let (r, g, b) = (
            srgb_to_linear(rgb.0),
            srgb_to_linear(rgb.1),
            srgb_to_linear(rgb.2),
        );
        let (l, c, h) = linear_srgb_to_oklch(r, g, b);
        return Ok(ParsedColor {
            l,
            c,
            h,
            alpha: rgb.3,
        });
    }

    // hsv(h, s%, v%) or hsb(h, s%, v%)
    if let Some(rgb) = try_parse_hsv(s) {
        let (r, g, b) = (
            srgb_to_linear(rgb.0),
            srgb_to_linear(rgb.1),
            srgb_to_linear(rgb.2),
        );
        let (l, c, h) = linear_srgb_to_oklch(r, g, b);
        return Ok(ParsedColor {
            l,
            c,
            h,
            alpha: None,
        });
    }

    // CSS named colors
    if let Some(rgb) = try_parse_named_color(s) {
        let (r, g, b) = (
            srgb_to_linear(rgb.0),
            srgb_to_linear(rgb.1),
            srgb_to_linear(rgb.2),
        );
        let (l, c, h) = linear_srgb_to_oklch(r, g, b);
        return Ok(ParsedColor {
            l,
            c,
            h,
            alpha: None,
        });
    }

    Err(format!("unrecognized color format: {}", s))
}

fn try_parse_oklch(s: &str) -> Option<(f64, f64, f64, Option<f64>)> {
    let s = s.strip_prefix("oklch(")?;
    let s = s.strip_suffix(')')?;
    // Handle "L C h / alpha" syntax
    let (lch_part, alpha) = if let Some((lch, a)) = s.split_once('/') {
        (lch.trim(), Some(a.trim().parse::<f64>().ok()?))
    } else {
        (s, None)
    };
    let parts: Vec<&str> = lch_part.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }
    let l = parts[0].parse::<f64>().ok()?;
    let c = parts[1].parse::<f64>().ok()?;
    let h = parts[2].parse::<f64>().ok()?;
    Some((l, c, h, alpha))
}

fn try_parse_hex(s: &str) -> Option<(f64, f64, f64, Option<f64>)> {
    let s = s.strip_prefix('#')?;
    let (r, g, b, alpha) = match s.len() {
        3 => {
            let r = u8::from_str_radix(&s[0..1], 16).ok()?;
            let g = u8::from_str_radix(&s[1..2], 16).ok()?;
            let b = u8::from_str_radix(&s[2..3], 16).ok()?;
            (r * 17, g * 17, b * 17, None)
        }
        6 => {
            let r = u8::from_str_radix(&s[0..2], 16).ok()?;
            let g = u8::from_str_radix(&s[2..4], 16).ok()?;
            let b = u8::from_str_radix(&s[4..6], 16).ok()?;
            (r, g, b, None)
        }
        8 => {
            let r = u8::from_str_radix(&s[0..2], 16).ok()?;
            let g = u8::from_str_radix(&s[2..4], 16).ok()?;
            let b = u8::from_str_radix(&s[4..6], 16).ok()?;
            let a = u8::from_str_radix(&s[6..8], 16).ok()?;
            (r, g, b, Some(a as f64 / 255.0))
        }
        _ => return None,
    };
    Some((r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0, alpha))
}

/// Parse rgb(r, g, b) or rgba(r, g, b, a). Supports 0-255 integer or 0%-100%.
fn try_parse_rgb(s: &str) -> Option<(f64, f64, f64, Option<f64>)> {
    let inner = if let Some(rest) = s.strip_prefix("rgba(") {
        rest.strip_suffix(')')
    } else if let Some(rest) = s.strip_prefix("rgb(") {
        rest.strip_suffix(')')
    } else {
        None
    }?;

    let parts: Vec<&str> = inner.split([',', '/']).map(|p| p.trim()).collect();
    if parts.len() < 3 {
        return None;
    }

    fn parse_channel(s: &str) -> Option<f64> {
        if let Some(pct) = s.strip_suffix('%') {
            Some(pct.trim().parse::<f64>().ok()? / 100.0)
        } else {
            Some(s.parse::<f64>().ok()? / 255.0)
        }
    }

    let r = parse_channel(parts[0])?.clamp(0.0, 1.0);
    let g = parse_channel(parts[1])?.clamp(0.0, 1.0);
    let b = parse_channel(parts[2])?.clamp(0.0, 1.0);
    let alpha = if parts.len() >= 4 {
        parts[3].parse::<f64>().ok()
    } else {
        None
    };
    Some((r, g, b, alpha))
}

/// Parse hsl(h, s%, l%) or hsla(h, s%, l%, a).
fn try_parse_hsl(s: &str) -> Option<(f64, f64, f64, Option<f64>)> {
    let inner = if let Some(rest) = s.strip_prefix("hsla(") {
        rest.strip_suffix(')')
    } else if let Some(rest) = s.strip_prefix("hsl(") {
        rest.strip_suffix(')')
    } else {
        None
    }?;

    let parts: Vec<&str> = inner.split([',', '/']).map(|p| p.trim()).collect();
    if parts.len() < 3 {
        return None;
    }

    let h = parts[0]
        .strip_suffix("deg")
        .unwrap_or(parts[0])
        .trim()
        .parse::<f64>()
        .ok()?;
    let s_pct = parts[1].strip_suffix('%')?.trim().parse::<f64>().ok()? / 100.0;
    let l_pct = parts[2].strip_suffix('%')?.trim().parse::<f64>().ok()? / 100.0;
    let alpha = if parts.len() >= 4 {
        parts[3].parse::<f64>().ok()
    } else {
        None
    };

    let (r, g, b) = hsl_to_srgb(h, s_pct, l_pct);
    Some((r, g, b, alpha))
}

fn hsl_to_srgb(h: f64, s: f64, l: f64) -> (f64, f64, f64) {
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let h_prime = (h % 360.0) / 60.0;
    let x = c * (1.0 - (h_prime % 2.0 - 1.0).abs());
    let (r1, g1, b1) = match h_prime as i32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = l - c / 2.0;
    (r1 + m, g1 + m, b1 + m)
}

/// Parse hsv(h, s%, v%) or hsb(h, s%, v%).
fn try_parse_hsv(s: &str) -> Option<(f64, f64, f64)> {
    let inner = if let Some(rest) = s.strip_prefix("hsv(") {
        rest.strip_suffix(')')
    } else if let Some(rest) = s.strip_prefix("hsb(") {
        rest.strip_suffix(')')
    } else {
        None
    }?;

    let parts: Vec<&str> = inner.split([',', '/']).map(|p| p.trim()).collect();
    if parts.len() < 3 {
        return None;
    }

    let h = parts[0]
        .strip_suffix("deg")
        .unwrap_or(parts[0])
        .trim()
        .parse::<f64>()
        .ok()?;
    let s_pct = parts[1].strip_suffix('%')?.trim().parse::<f64>().ok()? / 100.0;
    let v_pct = parts[2].strip_suffix('%')?.trim().parse::<f64>().ok()? / 100.0;

    Some(hsv_to_srgb(h, s_pct, v_pct))
}

fn hsv_to_srgb(h: f64, s: f64, v: f64) -> (f64, f64, f64) {
    let c = v * s;
    let h_prime = (h % 360.0) / 60.0;
    let x = c * (1.0 - (h_prime % 2.0 - 1.0).abs());
    let (r1, g1, b1) = match h_prime as i32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = v - c;
    (r1 + m, g1 + m, b1 + m)
}

/// CSS named colors → sRGB [0,1].
fn try_parse_named_color(s: &str) -> Option<(f64, f64, f64)> {
    let lower = s.to_lowercase();
    let (r, g, b) = match lower.as_str() {
        // Basic CSS colors
        "black" => (0, 0, 0),
        "white" => (255, 255, 255),
        "red" => (255, 0, 0),
        "green" | "lime" => (0, 128, 0),
        "blue" => (0, 0, 255),
        "yellow" => (255, 255, 0),
        "cyan" | "aqua" => (0, 255, 255),
        "magenta" | "fuchsia" => (255, 0, 255),
        "silver" => (192, 192, 192),
        "gray" | "grey" => (128, 128, 128),
        "maroon" => (128, 0, 0),
        "olive" => (128, 128, 0),
        "navy" => (0, 0, 128),
        "purple" => (128, 0, 128),
        "teal" => (0, 128, 128),
        // Extended CSS colors
        "orange" => (255, 165, 0),
        "pink" => (255, 192, 203),
        "coral" => (255, 127, 80),
        "salmon" => (250, 128, 114),
        "tomato" => (255, 99, 71),
        "gold" => (255, 215, 0),
        "khaki" => (240, 230, 140),
        "violet" => (238, 130, 238),
        "plum" => (221, 160, 221),
        "orchid" => (218, 112, 214),
        "indigo" => (75, 0, 130),
        "crimson" => (220, 20, 60),
        "chocolate" => (210, 105, 30),
        "sienna" => (160, 82, 45),
        "peru" => (205, 133, 63),
        "tan" => (210, 180, 140),
        "beige" => (245, 245, 220),
        "ivory" => (255, 255, 240),
        "linen" => (250, 240, 230),
        "snow" => (255, 250, 250),
        "seashell" => (255, 245, 238),
        "honeydew" => (240, 255, 240),
        "mintcream" => (245, 255, 250),
        "azure" => (240, 255, 255),
        "aliceblue" => (240, 248, 255),
        "lavender" => (230, 230, 250),
        "mistyrose" => (255, 228, 225),
        "whitesmoke" => (245, 245, 245),
        "gainsboro" => (220, 220, 220),
        "lightgray" | "lightgrey" => (211, 211, 211),
        "darkgray" | "darkgrey" => (169, 169, 169),
        "dimgray" | "dimgrey" => (105, 105, 105),
        "lightslategray" | "lightslategrey" => (119, 136, 153),
        "slategray" | "slategrey" => (112, 128, 144),
        "darkslategray" | "darkslategrey" => (47, 79, 79),
        "cornflowerblue" => (100, 149, 237),
        "royalblue" => (65, 105, 225),
        "steelblue" => (70, 130, 180),
        "dodgerblue" => (30, 144, 255),
        "deepskyblue" => (0, 191, 255),
        "skyblue" => (135, 206, 235),
        "lightskyblue" => (135, 206, 250),
        "lightblue" => (173, 216, 230),
        "powderblue" => (176, 224, 230),
        "cadetblue" => (95, 158, 160),
        "darkturquoise" => (0, 206, 209),
        "mediumturquoise" => (72, 209, 204),
        "turquoise" => (64, 224, 208),
        "lightcyan" => (224, 255, 255),
        "mediumaquamarine" => (102, 205, 170),
        "aquamarine" => (127, 255, 212),
        "darkgreen" => (0, 100, 0),
        "forestgreen" => (34, 139, 34),
        "seagreen" => (46, 139, 87),
        "mediumseagreen" => (60, 179, 113),
        "springgreen" => (0, 255, 127),
        "limegreen" => (50, 205, 50),
        "lightgreen" => (144, 238, 144),
        "palegreen" => (152, 251, 152),
        "darkseagreen" => (143, 188, 143),
        "greenyellow" => (173, 255, 47),
        "lawngreen" => (124, 252, 0),
        "chartreuse" => (127, 255, 0),
        "olivedrab" => (107, 142, 35),
        "yellowgreen" => (154, 205, 50),
        "darkolivegreen" => (85, 107, 47),
        "darkkhaki" => (189, 183, 107),
        "lemonchiffon" => (255, 250, 205),
        "palegoldenrod" => (238, 232, 170),
        "lightgoldenrodyellow" => (250, 250, 210),
        "lightyellow" => (255, 255, 224),
        "cornsilk" => (255, 248, 220),
        "goldenrod" => (218, 165, 32),
        "darkgoldenrod" => (184, 134, 11),
        "sandybrown" => (244, 164, 96),
        "burlywood" => (222, 184, 135),
        "wheat" => (245, 222, 179),
        "navajowhite" => (255, 222, 173),
        "peachpuff" => (255, 218, 185),
        "moccasin" => (255, 228, 181),
        "bisque" => (255, 228, 196),
        "blanchedalmond" => (255, 235, 205),
        "papayawhip" => (255, 239, 213),
        "antiquewhite" => (250, 235, 215),
        "oldlace" => (253, 245, 230),
        "floralwhite" => (255, 250, 240),
        "darkorange" => (255, 140, 0),
        "orangered" => (255, 69, 0),
        "firebrick" => (178, 34, 34),
        "darkred" => (139, 0, 0),
        "indianred" => (205, 92, 92),
        "lightcoral" => (240, 128, 128),
        "rosybrown" => (188, 143, 143),
        "hotpink" => (255, 105, 180),
        "deeppink" => (255, 20, 147),
        "mediumvioletred" => (199, 21, 133),
        "palevioletred" => (219, 112, 147),
        "blueviolet" => (138, 43, 226),
        "darkviolet" => (148, 0, 211),
        "darkorchid" => (153, 50, 204),
        "mediumpurple" => (147, 112, 219),
        "mediumorchid" => (186, 85, 211),
        "thistle" => (216, 191, 216),
        "darkmagenta" => (139, 0, 139),
        "mediumslateblue" => (123, 104, 238),
        "slateblue" => (106, 90, 205),
        "darkslateblue" => (72, 61, 139),
        "midnightblue" => (25, 25, 112),
        "mediumblue" => (0, 0, 205),
        "darkblue" => (0, 0, 139),
        "lightsteelblue" => (176, 196, 222),
        "lightsalmon" => (255, 160, 122),
        "darksalmon" => (233, 150, 122),
        "brown" => (165, 42, 42),
        "saddlebrown" => (139, 69, 19),
        "transparent" => return None, // no meaningful color
        _ => return None,
    };
    Some((r as f64 / 255.0, g as f64 / 255.0, b as f64 / 255.0))
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

/// Format a float to 4 decimal places, stripping trailing zeros.
fn fmt4(n: f64) -> String {
    let s = format!("{:.4}", n);
    // Parse and reformat to strip trailing zeros
    let v: f64 = s.parse().unwrap_or(n);
    // Use the same approach as palette-engine.ts: parseFloat(n.toFixed(4)).toString()
    if v == v.trunc() {
        format!("{}", v as i64)
    } else {
        format!("{}", v)
    }
}

// ---------------------------------------------------------------------------
// Command entry point
// ---------------------------------------------------------------------------

pub fn run_color(color: String, json_output: bool, quiet: bool) -> Result<i32, String> {
    let parsed = parse_color(&color)?;
    let tug_color = oklch_to_tug_color(parsed.l, parsed.c, parsed.h);

    if quiet {
        return Ok(0);
    }

    // Compute the sRGB hex for display
    let (lr, lg, lb) = oklch_to_linear_srgb(parsed.l, parsed.c, parsed.h);
    let sr = (linear_to_srgb(lr.clamp(0.0, 1.0)) * 255.0).round() as u8;
    let sg = (linear_to_srgb(lg.clamp(0.0, 1.0)) * 255.0).round() as u8;
    let sb = (linear_to_srgb(lb.clamp(0.0, 1.0)) * 255.0).round() as u8;
    let hex = format!("#{:02x}{:02x}{:02x}", sr, sg, sb);

    // Format alpha suffix for display
    let alpha_suffix = match parsed.alpha {
        Some(a) => format!(
            ", a: {}",
            (fmt4(a).parse::<f64>().unwrap_or(1.0) * 100.0).round() as i32
        ),
        None => String::new(),
    };
    let oklch_alpha = match parsed.alpha {
        Some(a) => format!(" / {}", fmt4(a)),
        None => String::new(),
    };

    let oklch_str = format!(
        "oklch({} {} {}{})",
        fmt4(parsed.l),
        fmt4(parsed.c),
        fmt4(parsed.h),
        oklch_alpha
    );

    if json_output {
        let alpha_json = match parsed.alpha {
            Some(a) => format!(r#","alpha":{}"#, fmt4(a)),
            None => String::new(),
        };
        println!(
            r#"{{"status":"ok","hue":"{}","intensity":{},"tone":{},"tug_color":"--tug-color({}, i: {}, t: {}{})","oklch":"{}","hex":"{}"{}}}"#,
            tug_color.hue,
            tug_color.intensity,
            tug_color.tone,
            tug_color.hue,
            tug_color.intensity,
            tug_color.tone,
            alpha_suffix,
            oklch_str,
            hex,
            alpha_json
        );
    } else {
        println!(
            "{} intensity={} tone={}",
            tug_color.hue, tug_color.intensity, tug_color.tone
        );
        println!(
            "  tug-color:  --tug-color({}, i: {}, t: {}{})",
            tug_color.hue, tug_color.intensity, tug_color.tone, alpha_suffix
        );
        println!("  oklch: {}", oklch_str);
        println!("  hex:   {}", hex);
    }

    Ok(0)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hex_parsing() {
        // Pure red
        let p = parse_color("#ff0000").unwrap();
        assert!(
            (p.h - 29.2).abs() < 1.0,
            "red hue should be ~29°, got {}",
            p.h
        );
        assert!(p.l > 0.0 && p.l < 1.0);
        assert!(p.c > 0.0);
        assert!(p.alpha.is_none());
    }

    #[test]
    fn test_short_hex() {
        let p1 = parse_color("#fff").unwrap();
        let p2 = parse_color("#ffffff").unwrap();
        assert!((p1.l - p2.l).abs() < 0.001);
        assert!((p1.c - p2.c).abs() < 0.001);
    }

    #[test]
    fn test_rgb_parsing() {
        let p = parse_color("rgb(255, 0, 0)").unwrap();
        assert!((p.h - 29.2).abs() < 1.0);
        assert!(p.alpha.is_none());
    }

    #[test]
    fn test_rgba_parsing() {
        let p = parse_color("rgba(0, 0, 255, 0.5)").unwrap();
        assert_eq!(p.alpha, Some(0.5));
    }

    #[test]
    fn test_hsl_parsing() {
        // hsl(0, 100%, 50%) = pure red
        let p = parse_color("hsl(0, 100%, 50%)").unwrap();
        assert!((p.h - 29.2).abs() < 1.0, "hsl red hue should be ~29°");
    }

    #[test]
    fn test_hsv_parsing() {
        // hsv(0, 100%, 100%) = pure red
        let p = parse_color("hsv(0, 100%, 100%)").unwrap();
        assert!((p.h - 29.2).abs() < 1.0, "hsv red hue should be ~29°");
    }

    #[test]
    fn test_oklch_parsing() {
        let p = parse_color("oklch(0.771 0.143 230)").unwrap();
        assert!((p.l - 0.771).abs() < 0.001);
        assert!((p.c - 0.143).abs() < 0.001);
        assert!((p.h - 230.0).abs() < 0.001);
        assert!(p.alpha.is_none());
    }

    #[test]
    fn test_oklch_alpha_parsing() {
        let p = parse_color("oklch(0.5 0.1 200 / 0.75)").unwrap();
        assert!((p.l - 0.5).abs() < 0.001);
        assert_eq!(p.alpha, Some(0.75));
    }

    #[test]
    fn test_hex_alpha_parsing() {
        let p = parse_color("#ff000080").unwrap();
        assert!((p.h - 29.2).abs() < 1.0);
        let a = p.alpha.unwrap();
        assert!((a - 0.502).abs() < 0.01, "alpha should be ~0.5, got {}", a);
    }

    #[test]
    fn test_hsla_parsing() {
        let p = parse_color("hsla(0, 100%, 50%, 0.3)").unwrap();
        assert!((p.h - 29.2).abs() < 1.0);
        assert_eq!(p.alpha, Some(0.3));
    }

    #[test]
    fn test_named_color() {
        let result = parse_color("coral");
        assert!(result.is_ok());
    }

    #[test]
    fn test_tug_color_round_trip_blue() {
        // blue canonical: oklch(0.771 0.143 230)
        let p = parse_color("oklch(0.771 0.143 230)").unwrap();
        let tc = oklch_to_tug_color(p.l, p.c, p.h);
        assert_eq!(tc.hue, "blue");
        assert_eq!(tc.intensity, 50);
        assert_eq!(tc.tone, 50);
    }

    #[test]
    fn test_canonical_data_loaded() {
        assert!(
            !palette_data::HUE_FAMILIES.is_empty(),
            "HUE_FAMILIES should be populated from palette-engine.ts"
        );
        assert_eq!(palette_data::HUE_FAMILIES.len(), 24);
        assert_eq!(palette_data::DEFAULT_CANONICAL_L.len(), 24);
        assert_eq!(palette_data::MAX_CHROMA_FOR_HUE.len(), 24);
    }

    #[test]
    fn test_unrecognized_input() {
        let result = parse_color("not-a-color");
        assert!(result.is_err());
    }

    #[test]
    fn test_hex_to_tug_color_dark_blue() {
        // #1c1e22 is a dark blue-gray from tug-tokens.css
        let p = parse_color("#1c1e22").unwrap();
        let tc = oklch_to_tug_color(p.l, p.c, p.h);
        assert!(tc.tone < 20, "dark color should have low tone");
        assert!(tc.intensity < 15, "near-gray should have low intensity");
    }

    #[test]
    fn test_srgb_round_trip() {
        // Verify sRGB → OKLCH → sRGB round-trip
        let r = 0.5_f64;
        let g = 0.3_f64;
        let b = 0.8_f64;
        let rl = srgb_to_linear(r);
        let gl = srgb_to_linear(g);
        let bl = srgb_to_linear(b);
        let (l, c, h) = linear_srgb_to_oklch(rl, gl, bl);
        let (rl2, gl2, bl2) = oklch_to_linear_srgb(l, c, h);
        assert!((rl - rl2).abs() < 0.001, "r round-trip failed");
        assert!((gl - gl2).abs() < 0.001, "g round-trip failed");
        assert!((bl - bl2).abs() < 0.001, "b round-trip failed");
    }
}
