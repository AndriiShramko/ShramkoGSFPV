// The vendored upstream code was written against the DOM lib, where Response.json() returns
// Promise<any>. The package is compiled without the DOM lib (Node types only), where it returns
// Promise<unknown>. This overload restores the upstream typing without touching vendored code.
export {};
declare global {
    interface Response {
        json(): Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    }
}
