#!/bin/sh

set -eu

command -v node >/dev/null 2>&1 || {
  printf 'Required command not found: node\n' >&2
  exit 1
}

node -e '
const { createECDH } = require("node:crypto");
const curve = createECDH("prime256v1");
curve.generateKeys();

let publicKey = curve.getPublicKey();
let privateKey = curve.getPrivateKey();
if (publicKey.length < 65) publicKey = Buffer.concat([Buffer.alloc(65 - publicKey.length), publicKey]);
if (privateKey.length < 32) privateKey = Buffer.concat([Buffer.alloc(32 - privateKey.length), privateKey]);

publicKey = publicKey.toString("base64url");
privateKey = privateKey.toString("base64url");
process.stdout.write(`WEB_PUSH_VAPID_PUBLIC_KEY=${publicKey}\n`);
process.stdout.write(`WEB_PUSH_VAPID_PRIVATE_KEY=${privateKey}\n`);
'
