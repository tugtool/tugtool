/**
 * pdf.ts — encode a real multi-page PDF at test time.
 *
 * Generated rather than checked in, so the repo carries no binary fixture and
 * a test can ask for however many pages its case needs.
 */

/**
 * A PDF with visible text on each page — objects, stream lengths, a
 * byte-accurate xref table, and the trailer.
 */
export function encodePdf(pageCount: number): Buffer {
  const objects: string[] = [];
  const fontId = 3 + pageCount * 2;
  const kids = Array.from(
    { length: pageCount },
    (_unused, i) => `${3 + i * 2} 0 R`,
  ).join(" ");
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>\n`);
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\n`);
  for (let i = 0; i < pageCount; i += 1) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> ` +
        `/Contents ${4 + i * 2} 0 R >>\n`,
    );
    const body = `BT /F1 36 Tf 72 700 Td (Page ${i + 1}) Tj ET\n`;
    objects.push(`<< /Length ${body.length} >>\nstream\n${body}endstream\n`);
  }
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\n`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}endobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
