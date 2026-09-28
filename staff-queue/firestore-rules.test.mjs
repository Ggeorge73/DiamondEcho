import { readFile } from "node:fs/promises";
import { test, after } from "node:test";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, collection, getDocs } from "firebase/firestore";
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Rules tests require the local emulator, never a live project.");
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
const env = await initializeTestEnvironment({projectId:"demo-diamondecho",
  firestore:{host,port:Number(port),rules:await readFile(new URL("../firestore.rules",import.meta.url),"utf8")}});
after(()=>env.cleanup());
for (const [name, context] of [
  ["anonymous", env.unauthenticatedContext()],
  ["signed-in nonstaff", env.authenticatedContext("other")],
  ["staff (API only)", env.authenticatedContext("staff-1",{email_verified:true,firebase:{sign_in_second_factor:"totp"}})]
]) {
  test(name + " cannot read, list or write inquiry documents", async()=>{
    const db = context.firestore();
    await assertFails(getDoc(doc(db,"inquiries/test")));
    await assertFails(getDocs(collection(db,"inquiries")));
    await assertFails(setDoc(doc(db,"inquiries/test"),{email:"synthetic@example.com"}));
    await assertFails(getDoc(doc(db,"status_checks/test")));
  });
}
