import { chromium, devices, webkit } from "@playwright/test";
import { Simulation } from "../src/sim/simulation";

const developedReplay = new Simulation(0x47_4f_44, "skirmish");
developedReplay.advanceTo(2_400);

const url = process.env.PROFILE_URL ?? "http://127.0.0.1:4173";
const configurations = [
  {
    name: "desktop-chromium",
    type: chromium,
    device: devices["Desktop Chrome"],
  },
  { name: "desktop-webkit", type: webkit, device: devices["Desktop Safari"] },
  { name: "phone-chromium", type: chromium, device: devices["Pixel 7"] },
  { name: "phone-webkit", type: webkit, device: devices["iPhone 14"] },
] as const;

for (const configuration of configurations) {
  if (
    process.env.PROFILE_ONLY &&
    process.env.PROFILE_ONLY !== configuration.name
  ) {
    continue;
  }
  const browser = await configuration.type.launch();
  const context = await browser.newContext(configuration.device);
  const page = await context.newPage();
  await page.addInitScript((replay) => {
    localStorage.setItem(
      "worldling.session.v1",
      JSON.stringify({ version: 1, replay }),
    );
  }, developedReplay.toReplay());
  await page.goto(url);
  await page.getByTestId("dismiss-guide").click();
  const result = await page.evaluate<Record<string, unknown>>(`(async () => {
    const longTasks = [];
    const observer = typeof PerformanceObserver === "function"
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        })
      : null;
    try {
      observer?.observe({ entryTypes: ["longtask"] });
    } catch {}
    const intervals = [];
    let previous = 0;
    await new Promise((resolve) => {
      const sample = (time) => {
        if (previous > 0) intervals.push(time - previous);
        previous = time;
        if (intervals.length >= 180) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    observer?.disconnect();
    intervals.sort((first, second) => first - second);
    const percentile = (fraction) => intervals[
      Math.min(intervals.length - 1, Math.floor(intervals.length * fraction))
    ];
    return {
      medianFrameMs: Number(percentile(0.5).toFixed(2)),
      p95FrameMs: Number(percentile(0.95).toFixed(2)),
      approximateFps: Number((1000 / percentile(0.5)).toFixed(1)),
      longestFrameMs: Number(intervals.at(-1).toFixed(2)),
      longTasks,
      people: document.querySelector("#population-count")?.textContent,
      houses: document.querySelector("#house-count")?.textContent,
    };
  })()`);
  console.log(JSON.stringify({ configuration: configuration.name, ...result }));
  await browser.close();
}
