import { test } from "bun:test"
import { expectNativeDdrVisibility } from "./fixtures/expect-native-ddr-visibility"

test("A64 byte 2 checks copper visibility beside the first two bytes", async () => {
  await expectNativeDdrVisibility("a64-byte2", import.meta.path)
}, 180_000)
