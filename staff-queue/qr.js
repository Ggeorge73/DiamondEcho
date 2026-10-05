import qrcode from "qrcode-generator";

// What the authenticator app shows for this account. The project is part of the
// account name so that a staging entry and a production entry for the same
// email stay two entries instead of one replacing the other.
export const ISSUER = "DiamondEcho staff";
export const setupIssuer = () => encodeURIComponent(ISSUER);
export const setupAccount = (email, projectId) => encodeURIComponent(email + " (" + projectId + ")");

// The grid for a QR code holding this text: rows of true (dark) and false.
// Error correction level M, the size chosen by the library to fit the text.
export function qrMatrix(text) {
  const code = qrcode(0, "M");
  code.addData(text, "Byte");
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => code.isDark(row, column)));
}
