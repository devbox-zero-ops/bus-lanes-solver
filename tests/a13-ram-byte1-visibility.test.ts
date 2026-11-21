import { test } from "bun:test"
import { expectNativeDdrVisibility } from "./fixtures/expect-native-ddr-visibility"

test("A13 RAM byte 1 checks copper visibility beside three routed bytes", async () => {
  await expectNativeDdrVisibility("a13-ram-byte1", import.meta.path)
}, 240_000)
