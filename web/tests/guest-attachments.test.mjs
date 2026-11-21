import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {fileURLToPath} from "node:url";

test("guest uploads encrypted PDF, actually sends it to Sol, and retains it at registration",async()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"al-guest-upload-"));
  const provider=path.join(temp,"mock-model.mjs");
  fs.writeFileSync(provider,String.raw