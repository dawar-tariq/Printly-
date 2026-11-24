# Protected Android review build on this branch

This is a **review build**, not a publication or website deployment. The public repository is `dawar-tariq/Printly-`; the working branch is `arena/309fdf51-printly`. The Android package is `io.github.dawartariq.printly.owner`, currently with `versionCode` 1. The new website routes and notifications are not yet deployed or configured. Do not give a review APK to shop owners or assume it will upgrade an existing installation.

The workflow creates an encrypted APK artifact rather than an unencrypted one, because anyone with read access to a public repository may download GitHub Actions artifacts. Public package, signer and checksum evidence accompanies the encrypted file; neither the keystore nor passwords are uploaded. The independent artifact passphrase is needed to decrypt it.

## 1. Identify the existing signing key

Keep the keystore, alias and passwords private and backed up. Never put them in chat, source files, logs or screenshots. On your own computer, JDK's `keytool` can inspect the keystore without placing the password in shell history:

```sh
keytool -list -v -keystore "/secure/path/to/your-existing.keystore"
```

Enter the store password privately when prompted. Note the keystore type (`JKS` or `PKCS12`), the alias of the intended `PrivateKeyEntry`, and that entry's certificate **SHA-256 fingerprint**. A certificate fingerprint is public; it is not the APK file's SHA-256. Record the fingerprint through a trusted, independent process.

If there may already be an installed APK for this package, inspect the original APK with Android SDK tools before any distribution:

```sh
apksigner verify --verbose --print-certs "/path/to/existing-printly.apk"
aapt dump badging "/path/to/existing-printly.apk"
```

Confirm the package, signer fingerprint and version code against the intended existing installation. An upgrade must use the same effective app-signing key and a higher version code. Google Play App Signing can use a different **app-signing** key from the upload key; a direct-distributed update signed only by the upload key may not upgrade a Play-installed app. If the existing app or key is uncertain, treat version 1 as review-only until an authorized operator verifies this. Do not remove an existing installation merely to make a mismatched APK install.

## 2. Configure GitHub's protected environment

1. Review the exact branch, `.github/workflows/android-release.yml`, `scripts/check-android-signing-environment.mjs`, `scripts/encrypt-android-review.sh`, Gradle wrapper and Android build inputs. Anyone able to change build code or approve an untrusted workflow could steal signing credentials. Restrict repository administrators and workflow access accordingly.
2. In [repository Settings → Environments](https://github.com/dawar-tariq/Printly-/settings/environments), create `printly-owner-signing`. Under protection rules, require at least one trusted reviewer, **disable “Allow administrators to bypass configured protection rules”**, and restrict deployments to **only** the exact branch `arena/309fdf51-printly` using selected branches/tags. Do not allow wildcard or additional branch/tag rules. If a second independent reviewer is available, also enable prevent self-review. Save the rules and check them in GitHub's UI. Environment protections for public repositories depend on GitHub's product/plan rules; this workflow deliberately refuses to run if the repository is private or the settings cannot be verified.
3. Add these **environment variables** in that environment, independently from the keystore secrets:
   - `PRINTLY_ANDROID_KEYSTORE_TYPE`: `JKS` or `PKCS12`, as reported by `keytool`.
   - `PRINTLY_ANDROID_EXPECTED_CERT_SHA256`: the independently checked certificate fingerprint, as 64 hexadecimal characters or colon-separated byte pairs. If there is an earlier installation, compare with its real app-signing certificate first.
4. Add these **environment secrets**, not repository- or organization-wide secrets:
   - `PRINTLY_ANDROID_KEYSTORE_BASE64`: base64 of the original keystore bytes.
   - `PRINTLY_ANDROID_KEYSTORE_PASSWORD`.
   - `PRINTLY_ANDROID_KEY_ALIAS`.
   - `PRINTLY_ANDROID_KEY_PASSWORD`.
   - `PRINTLY_ANDROID_ARTIFACT_PASSPHRASE`: a separate, strong, single-line passphrase of at least 24 characters; do not reuse a signing password. Retain it securely until the artifact has been decrypted.

For example, with GitHub CLI installed and authenticated **on your own computer**, Linux/macOS users can securely send the keystore bytes to the environment without printing them:

```sh
base64 < "/secure/path/to/your-existing.keystore" | tr -d '\r\n' | gh secret set PRINTLY_ANDROID_KEYSTORE_BASE64 --repo dawar-tariq/Printly- --env printly-owner-signing
```

On Windows PowerShell the equivalent is:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\secure\your-existing.keystore')) | gh secret set PRINTLY_ANDROID_KEYSTORE_BASE64 --repo dawar-tariq/Printly- --env printly-owner-signing
```

Set the remaining secrets privately in GitHub's environment UI. Do not type passwords into command-line arguments. The agent cannot read or independently verify secret values and does not need them in chat. Environment secrets require a GitHub account authorized to configure the repository.

## 3. Request and approve a review build

After protections and secrets are configured, tell the agent only that setup is complete. Before a signing run, inspect the non-secret environment metadata and agree on the intended version. A deliberate change to `apps/printly-owner-android/signed-review-request.json` on this branch triggers the workflow; the `.example.json` file is **not** a request. The preflight checks the repository, exact branch, required reviewer, disabled administrator bypass and exact branch policy before requesting approval. GitHub then holds the signing job for the environment reviewer. Recheck the commit SHA, workflow, Android source, certificate and version before approving; reject or cancel any unexpected request. The protection check runs again after approval. These checks are defense in depth, not a substitute for reviewing trusted code and controlling repository-admin access.

The existing manual trigger needs this workflow on the default branch before GitHub exposes it; this branch's explicit request-file trigger does not require a merge. Do not merge or deploy merely to obtain a review build.

## 4. Decrypt and verify the result

Download the short-lived `printly-owner-signed-review-encrypted` Actions artifact. Install GnuPG on your computer if needed, then run:

```sh
gpg --output Printly-owner-review.apk --decrypt app-release.apk.gpg
sha256sum Printly-owner-review.apk
apksigner verify --verbose --print-certs Printly-owner-review.apk
aapt dump badging Printly-owner-review.apk
```

GnuPG prompts privately for the artifact passphrase and checks its integrity. Verify the APK's file SHA-256 against the run's independently viewed checksum, then verify the signer, package, origin and version against trusted records. Android must still verify the APK signature on installation. Test on a real device, including a safe upgrade test when applicable. This workflow does not configure Digital Asset Links, notifications, hosting, downloads or updates; those require their own tested, separately authorized rollout.
