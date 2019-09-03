import config from "config";

export const appContext = {
    isRunning: true,
    syncThrottleTime: 4000,
    config: {
        app: config.get<any>("app"),
        node: config.get<any>("node")
    }
};

export function waitAsync(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}