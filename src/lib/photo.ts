/**
 * Shrinking a receipt photo before it leaves the phone.
 *
 * A modern phone camera produces something like four megabytes and twelve
 * megapixels. None of that helps read a receipt, and all of it costs upload
 * time on restaurant wifi and image tokens at the other end. Around fourteen
 * hundred pixels on the long edge is comfortably enough to read printed
 * receipt text, and takes the file to roughly a tenth of the size.
 */
export async function prepareReceiptPhoto(
  file: File,
  maxEdge = 1400
): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas context");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.75)
    );
    if (!blob) throw new Error("could not encode");
    return blob;
  } catch {
    // A format this browser will not decode into a canvas, or a canvas that
    // refuses to encode. Send what was picked and let the server say whether
    // it can read it, rather than refusing here on a guess.
    return file;
  }
}
