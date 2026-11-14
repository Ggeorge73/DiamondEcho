// A pretend network and clock for the load generator's tests. Time is
// virtual: it moves only when the test drives it, so a "20-second" scenario
// runs in milliseconds and gives the same numbers every time. Nothing here
// opens a socket.
//
//   const io = fakeIo({ respond: (url, init) => ({ status: 200, body: '"ok"', ms: 20 }) });
//   const result = await io.drive(runScenario(scenario, "http://127.0.0.1:8080", { io }));
//   io.calls  -> every request the generator tried to send
export function fakeIo({ respond = () => ({ status: 200, body: "{}", ms: 10 }) } = {}) {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const calls = [];

  const io = {
    calls,
    now: () => now,
    setTimeout(fn, ms) {
      nextId += 1;
      timers.set(nextId, { at: now + Math.max(0, ms), fn, order: nextId });
      return nextId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    fetch(url, init = {}) {
      calls.push({ url: String(url), method: init.method ?? "GET", redirect: init.redirect, headers: init.headers, body: init.body });
      const answer = respond(String(url), init);
      if (answer.throws) return Promise.reject(answer.throws);
      return new Promise((resolve, reject) => {
        const id = io.setTimeout(() => {
          const bytes = new TextEncoder().encode(answer.body ?? "");
          resolve({ status: answer.status ?? 200, arrayBuffer: async () => bytes.buffer });
        }, answer.ms ?? 0);
        init.signal?.addEventListener("abort", () => {
          timers.delete(id);
          const error = new Error("This operation was aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    },
    /** Run `promise` to completion, firing timers in time order. */
    async drive(promise) {
      let settled = false;
      promise.then(() => { settled = true; }, () => { settled = true; });
      for (let turns = 0; turns < 1_000_000; turns += 1) {
        // Let every promise that can move, move, before time advances.
        await new Promise((resolve) => setImmediate(resolve));
        if (settled) return promise;
        let next = null;
        for (const [id, timer] of timers) {
          if (!next || timer.at < next.timer.at || (timer.at === next.timer.at && timer.order < next.timer.order)) next = { id, timer };
        }
        if (!next) throw new Error("fake-io: the run is waiting on nothing (a deadlock in the test or the runner)");
        timers.delete(next.id);
        now = Math.max(now, next.timer.at);
        next.timer.fn();
      }
      throw new Error("fake-io: gave up after a million timer turns");
    },
  };
  return io;
}
