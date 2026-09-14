import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { hosts } from "../main/tailnet";

test("hosts sorts tailnet and LAN addresses while excluding internal, IPv6 and self-assigned addresses", (t) => {
  const addresses = [
    "100.128.0.1", "100.127.255.255", "192.168.1.5", "100.100.100.100",
    "100.64.0.0", "100.63.255.255", "169.254.1.2", "10.0.0.1",
  ];
  t.mock.method(os, "networkInterfaces", () => ({
    absent: undefined,
    external: addresses.map((address) => ({ address, family: "IPv4", internal: false })),
    loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    ipv6: [{ address: "::1", family: "IPv6", internal: false }],
  }));
  assert.deepEqual(hosts(), {
    tailnet: ["100.100.100.100", "100.127.255.255", "100.64.0.0"],
    lan: ["10.0.0.1", "100.128.0.1", "100.63.255.255", "192.168.1.5"],
  });
});

test("hosts skips virtual interfaces and offers built-in Ethernet and Wi-Fi first", (t) => {
  const on = (address: string) => [{ address, family: "IPv4", internal: false }];
  t.mock.method(os, "networkInterfaces", () => ({
    vnic0: on("10.211.55.2"),
    utun4: on("10.8.0.2"),
    utun5: on("100.100.1.1"),
    bridge100: on("192.168.2.1"),
    en0: on("192.168.1.20"),
    en5: on("172.16.0.9"),
    ppp0: on("10.9.0.3"),
  }));
  assert.deepEqual(hosts(), { tailnet: ["100.100.1.1"], lan: ["172.16.0.9", "192.168.1.20", "10.9.0.3"] });
});
