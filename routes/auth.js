import express from "express";
import { createAccount, signin } from "../controllers/auth.js";


const router = express.Router();

// DASHBOARD

router.post("/signin", signin);
router.post("/create-account", createAccount);

//

export default router;
