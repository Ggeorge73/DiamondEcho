import { createStaffAuth } from "./firebase-auth.js";
window.DIAMOND_ECHO_STAFF_AUTH = createStaffAuth(window.DIAMOND_ECHO_STAFF_CONFIG);
import("./app.js");
