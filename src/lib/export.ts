/**
 * Helper to convert a local URL (e.g. blob URL or relative path) into a base64 Data URL,
 * ensuring that exported HTML files are self-contained.
 */
export async function toBase64(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('Failed to convert image to base64:', e);
    return url;
  }
}
