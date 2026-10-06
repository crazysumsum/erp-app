# Diagnostic reference recovery — revision 73 → 74

Nineteen raw task diagnostics were mistakenly classified as executable runner records. The normal checkpoint rejected reclassification because its flat monotonic-path rule cannot distinguish diagnostic paths from run records. This narrow recovery retains all diagnostic files, byte/hash inventories below, historical committed states71–73 and a private exact revision73 snapshot. All34 genuine typed runner JSON references, approvals, mode/status, task dispositions and mode-entry baseline are unchanged. No result is fabricated and no gate requirement is waived.

Actual separate reviewer /root/sales_readiness_review approved this bookkeeping repair against state SHA256 9a3576d81ed6be3cccc98b1f44ea9cbb224c655e9135b300a4d14e872bd234a7, conditional on resulting diff verification. Recovery uses an exclusive same-directory lock, expectedrevision73+exact byte hash, typed state/semantic validation and atomic replace. The sole exception is reclassifying known non-run diagnostics out of evidence_files; original references remain in this inventory and historical states. P0 runner records remain historical; no P1 Phase PASS/CI/merge readiness is implied.

After-diff verification actually APPROVED by the same separate reviewer against revision75 SHA256 `3702712f36f4d4c60857ab5472f97938f29911080cc56474c94b140647b87acb`: all34 runner records unchanged/valid, all19 diagnostic files and hashes retained, original state history and approvals preserved; zero state validation issues. Current baseline is fresh-main merge `07f7611` with source `1aed1b18e6103825cb2eb7e366b44f347e59f61c5bb24c80d887e11805c92b90`. No SQL or product change was part of this repair.

- `evidence/task012/task012-empty.log` — 3784 bytes; SHA256 `63b461f24fd3d26db08e2185e03fe61ca3a503f5128b3a8efe326ba6c432d53f`
- `evidence/task012/task012-upgrade.log` — 4957 bytes; SHA256 `abdb536899192acf1a6f458caa7b439bb8f4e0cd8cd07365fac3cab82e8a5ae6`
- `evidence/task012/task012-green.log` — 547 bytes; SHA256 `9a08e541a1ca84ad3f2837a7833df250b0897c942ca71507c59cec85f8ddee9a`
- `evidence/task012/task012-server-regression.log` — 258476 bytes; SHA256 `78e74c32f3f65bfd341d272abe99986a33bd6ec354be422cf7717b4b0859b8cf`
- `evidence/task012/task012-lint.log` — 34 bytes; SHA256 `6bb1ee595ad4a18e79d4765b8d4ac46297b3f844e713cdf91411b06c8ede59e2`
- `evidence/task012/task012-red.log` — 1602 bytes; SHA256 `8141c2bd0d28f0f754f6ba89b93ce291ffc7158c6c41601abca935d0098a0553`
- `evidence/task013/task013-empty.log` — 3943 bytes; SHA256 `d6f8c6562fc3f2045e5d9f67ccddefdd1fc20e4fa746afb57b27878b68a273d5`
- `evidence/task013/task013-server-regression.log` — 258881 bytes; SHA256 `027b3406bfeda2e7600d630ba570caf2895d3c601e9b21555a80e7651db9ff9f`
- `evidence/task013/task013-lint.log` — 34 bytes; SHA256 `6bb1ee595ad4a18e79d4765b8d4ac46297b3f844e713cdf91411b06c8ede59e2`
- `evidence/task013/task013-green.log` — 453 bytes; SHA256 `2bb1062ba9c7b4056ca0ffa3bbf82e0d7d616fd592206e55213258faa9cd2cde`
- `evidence/task013/task013-red.log` — 1596 bytes; SHA256 `46c46ed85d9686f4bde57abd17383b1092b1affb3d84dbc67db236d54b60a84c`
- `evidence/task013/task013-upgrade.log` — 5150 bytes; SHA256 `3cbbc31af4d0f57b69e4230f6c33e28dd652ea5d8765bf4373bc5a6980bc0de9`
- `evidence/task014/task014-native.log` — 1327 bytes; SHA256 `51358c69ef3dcbc4473f8cc8937461e11fa732c32922a864af5af127916c0700`
- `evidence/task014/task014-red.log` — 1646 bytes; SHA256 `20866f1ffbd4950ec555d523fb0b29df62d6716c3ea607309fc360431537b5a9`
- `evidence/task014/task014-final-empty.log` — 4117 bytes; SHA256 `e563bf6a76896f4abed3491e65ce9f9f61f0ebdedaee9461ffde72b6c91cf83b`
- `evidence/task014/task014-p0-baseline-empty.log` — 3677 bytes; SHA256 `8170548290eee84a4a71f90af5913fb9887f993399098b6cc1b65bd9cce29bc2`
- `evidence/task014/task014-lint.log` — 34 bytes; SHA256 `6bb1ee595ad4a18e79d4765b8d4ac46297b3f844e713cdf91411b06c8ede59e2`
- `evidence/task014/task014-final-upgrade.log` — 5290 bytes; SHA256 `b231b7722a2c243b1f4c15248254ac693005f11f0329416b3298699df9db6bb0`
- `evidence/task014/task014-server-regression.log` — 259313 bytes; SHA256 `57fdfd8f43c07ed5b06815c15f4f7cf12abed5a70f180669f59dac2719f1c5c9`
