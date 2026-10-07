// Safari before 17.4 (iPadOS 16 / early 17) lacks Promise.withResolvers. Without it the
// pre-level quiz rejects inside GoToGame and the game hangs on the loading flower.
if (typeof Promise.withResolvers !== "function") {
  Object.defineProperty(Promise, "withResolvers", {
    configurable: true,
    writable: true,
    value: function withResolvers() {
      let resolve;
      let reject;
      const promise = new this((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    },
  });
}
