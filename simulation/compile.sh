#!/bin/sh
# To run this, you'll need to install
# LLVM: https://chocolatey.org/packages/llvm
clang --target=wasm32 -O3 -flto --no-standard-libraries -Wl,--no-entry -Wl,--lto-O3 -Wl,--import-memory \
-Wl,--export=__heap_base \
-Wl,--export=cellIndex \
-Wl,--export=simulateSand \
-Wl,--export=simulateWater \
-Wl,--export=updateColor \
-Wl,--export=updateLight \
-o simulation.wasm simulation.c
