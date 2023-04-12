import { assertEquals } from "std/testing/asserts.ts";
import { delay } from "std/async/mod.ts";

import { LocalChannel, LocalHub, Tagged } from "./node-comm.ts";

Deno.test("Local channel", async (t) => {
  const c = new LocalChannel<string>();
  await t.step("send", async () => {
    await c.send_message("hello");
    await c.send_message("world");
  });

  await t.step("receive", async () => {
    assertEquals(await c.get_message(), "hello");
    assertEquals(await c.get_message(), "world");
  });

  await t.step("receive first", async () => {
    await Promise.all([
      (async () => {
        assertEquals(await c.get_message(), "你好");
        assertEquals(await c.get_message(), "世界");
      })(),
      (async () => {
        await delay(100);
        await c.send_message("你好");
        await delay(100);
        await c.send_message("世界");
      })(),
    ]);
  });
});

Deno.test("send in a circle", async (t) => {
  const nodes = ["A", "B", "C", "D", "E"];
  const n = nodes.length;
  const network = new Map<string, string[]>();
  for (let i = 0; i < n; i++) {
    network.set(nodes[i], [nodes[(i + 1) % n]]);
  }
  const hub = new LocalHub<string>(network);
  const comms = nodes.map((node) => hub.get_communicator(node));

  await t.step("all send", async () => {
    await Promise.all(
      nodes.map((_, i) =>
        comms[i].send_message(nodes[(i + 1) % n], `hello from ${i}`)
      ),
    );
  });

  await t.step("all receive", async () => {
    await Promise.all(nodes.map(async (_, i) => {
      const msg = await comms[(i + 1) % n].get_message(nodes[i]);
      assertEquals(msg.from, nodes[i]);
      assertEquals(msg.message, `hello from ${i}`);
    }));
  });

  await t.step("make the dance", async () => {
    await Promise.all([
      (async () => {
        await comms[0].send_message(nodes[1], "x");
        const last_message = await comms[0].get_message(nodes[4]);
        assertEquals(last_message.from, nodes[4]);
        assertEquals(last_message.message, "yzyzyz");
      })(),
      (async () => {
        // await delay(100);
        const msg = await comms[1].get_message(nodes[0]);
        assertEquals(msg.from, nodes[0]);
        assertEquals(msg.message, "x");
        await comms[1].send_message(nodes[2], "y");
        await comms[1].send_message(nodes[2], "z");
      })(),
      (async () => {
        const msg1 = await comms[2].get_message(nodes[1]),
          msg2 = await comms[2].get_message(nodes[1]);
        assertEquals(msg1.from, nodes[1]);
        assertEquals(msg1.message, "y");
        assertEquals(msg2.from, nodes[1]);
        assertEquals(msg2.message, "z");
        const msg3 = msg1.message + msg2.message;
        await comms[2].send_message(nodes[3], msg3);
      })(),
      (async () => {
        const msg = await comms[3].get_message(nodes[2]);
        assertEquals(msg.from, nodes[2]);
        assertEquals(msg.message, "yz");
        for (let i = 0; i < 3; i++) {
          await comms[3].send_message(nodes[4], msg.message);
        }
      })(),
      (async () => {
        const messages: Tagged<string>[] = [];
        for (let i = 0; i < 3; i++) {
          messages.push(await comms[4].get_message(nodes[3]));
        }
        assertEquals(messages.map((msg) => msg.message), ["yz", "yz", "yz"]);
        const joined = messages.map((msg) => msg.message).join("");
        await comms[4].send_message(nodes[0], joined);
      })(),
    ]);
  });
});

Deno.test("calculate a sum of squares", async (t) => {
  const workers = ["A", "B", "C", "D", "E"];
  const dispatcher = "X";
  const network = new Map<string, string[]>();
  for (const x of workers) {
    network.set(x, [dispatcher]);
  }
  network.set(dispatcher, workers);

  const hub = new LocalHub<number>(network);
  const comm_dispatch = hub.get_communicator(dispatcher);
  const comm_workers = workers.map((worker) => hub.get_communicator(worker));

  await t.step("dispatch", async () => {
    const numbers = [1, 2, 3, 4, 5];
    await Promise.all(
      numbers.map(async (num, i) =>
        await comm_dispatch.send_message(workers[i], num)
      ),
    );
  });

  await t.step("calculate square", async () => {
    await Promise.all(
      workers.map(async (_, i) => {
        const num = await comm_workers[i].get_message(dispatcher);
        assertEquals(num.from, dispatcher);
        await comm_workers[i].send_message(
          dispatcher,
          num.message * num.message,
        );
      }),
    );
  });

  await t.step("sum", async () => {
    const squares = await Promise.all(
      workers.map(async (worker) => {
        const num = await comm_dispatch.get_message(worker);
        assertEquals(num.from, worker);
        return num.message;
      }),
    );
    const sum = squares.reduce((a, b) => a + b, 0);
    assertEquals(sum, 55);
  });
});
