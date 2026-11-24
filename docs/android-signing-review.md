# Protected Android review build on this branch

This is a **review build**, not a publication or website deployment. The public repository is `dawar-tariq/Printly-`; the working branch is `arena/309fdf51-printly`. The Android package is `io.github.dawartariq.printly.owner`, currently with `versionCode` 1. The new website routes and notifications are not yet deployed or configured. Do not give a review APK to shop owners or assume it will upgrade an existing installation.

The workflow creates an encrypted APK artifact rather than an unencrypted one, because anyone with read access to a public repository may download GitHub Actions artifacts. Public package, signer and checksum evidence accompanies the encrypted file; neither the keystore nor passwords are uploaded. The independent artifact passphrase is needed to decrypt it. After approval, the workflow first encrypts and decrypts harmless sample data; if that check fails it reports a non-secret error category and never uses the signing key.

## 1. Verify the release key and any existing installation

A new release key was created for this app and backed up in private storage. The keystore is `printly-owner-release.p12`, the type is `PKCS12`, and the alias is `printly-owner-release`; its password is saved separately. The saved `signing-info.txt` and `certificate.pem` contain the **public** certificate information. Verify that fingerprint independently before configuring the signing environment. A certificate fingerprint is public; it is not the APK file's SHA-256.

Keep the keystore and password private and backed up. Never put them in chat, source files, logs or screenshots. For example, on a trusted computer JDK's `keytool` can inspect the keystore without placing the password in shell history:

```sh
keytool -list -v -storetype PKCS12 -keystore "/secure/path/to/printly-owner-release.p12"
```

Enter the store password privately when prompted. Verify the `PrivateKeyEntry` alias and its certificate **SHA-256 fingerprint** against the saved public information.

This branch's protected workflow is deliberately specific to that PKCS12 key: it uses the `printly-owner-release` alias and the same password for the key and keystore. If an earlier installation requires a different key, do not run this workflow unchanged; investigate the existing signer and update the release process first.

If there may already be an installed APK for this package, inspect the original APK with Android SDK tools before any distribution:

```sh
apksigner verify --verbose --print-certs "/path/to/existing-printly.apk"
aapt dump badging "/path/to/existing-printly.apk"
```

Confirm the package, signer fingerprint and version code against the intended existing installation. An upgrade must use the same effective app-signing key and a higher version code. Google Play App Signing can use a different **app-signing** key from the upload key; a direct-distributed update signed only by the upload key may not upgrade a Play-installed app. If the existing app or key is uncertain, treat version 1 as review-only until an authorized operator verifies this. Do not remove an existing installation merely to make a mismatched APK install.

## 2. Configure GitHub's protected environment

1. Review the exact branch, `.github/workflows/android-release.yml`, `scripts/check-android-signing-environment.mjs`, `scripts/sign-android-review.sh`, `scripts/encrypt-android-review.sh`, Gradle wrapper and Android build inputs. Anyone able to change build code or approve an untrusted workflow could steal signing credentials. Restrict repository administrators and workflow access accordingly.
2. In [repository Settings → Environments](https://github.com/dawar-tariq/Printly-/settings/environments), create `printly-owner-signing`. Under protection rules, require at least one trusted reviewer, **disable “Allow administrators to bypass configured protection rules”**, and restrict deployments to **only** the exact branch `arena/309fdf51-printly` using selected branches/tags. Do not allow wildcard or additional branch/tag rules. If a second independent reviewer is available, also enable prevent self-review. Save the rules and check them in GitHub's UI. Environment protections for public repositories depend on GitHub's product/plan rules; this workflow deliberately refuses to run if the repository is private or the settings cannot be verified.
3. Add the **environment variable** `PRINTLY_ANDROID_EXPECTED_CERT_SHA256`: the independently checked public certificate fingerprint, as 64 hexadecimal characters or colon-separated byte pairs. If there is an earlier installation, compare with its real app-signing certificate first.
4. Add these **environment secrets**, not repository- or organization-wide secrets:
   - `PRINTLY_ANDROID_KEYSTORE_BASE64`: base64 of the original keystore bytes.
   - `PRINTLY_ANDROID_KEYSTORE_PASSWORD`: the password for both the PKCS12 keystore and its key.
   - `PRINTLY_ANDROID_ARTIFACT_PASSPHRASE`: a separate, strong, single-line passphrase of at least 24 characters; do not reuse a signing password. Retain it securely until the artifact has been decrypted.

For example, with GitHub CLI installed and authenticated **on your own computer**, Linux/macOS users can securely send the keystore bytes to the environment without printing them:

```sh
base64 < "/secure/path/to/printly-owner-release.p12" | tr -d '\r\n' | gh secret set PRINTLY_ANDROID_KEYSTORE_BASE64 --repo dawar-tariq/Printly- --env printly-owner-signing
```

On Windows PowerShell the equivalent is:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\secure\printly-owner-release.p12')) | gh secret set PRINTLY_ANDROID_KEYSTORE_BASE64 --repo dawar-tariq/Printly- --env printly-owner-signing
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
