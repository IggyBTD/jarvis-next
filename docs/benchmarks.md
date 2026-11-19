# Model benchmarks

Run on the PC with the model loaded: `node scripts/bench-model.js --label "rocm mtp-off" --write`.

Expected before measuring: Q4 of a 27B is about 16.5 to 16.8 GB, so with 16 GB of VRAM expect partial CPU offload and roughly 10 to 12 tokens per second without MTP. MTP can slow prompt processing (one report: about 35 percent at 16k context), so judge it on real tasks. No RX 9070 data was found when this was written. Nothing is measured yet.
