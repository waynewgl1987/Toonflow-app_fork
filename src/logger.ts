import * as fs from "fs";
import * as path from "path";
import getPath from "@/utils/getPath";

type LogLevel = "log" | "info" | "warn" | "error" | "debug";
type ConsoleMethod = (...args: unknown[]) => void;

const LOG_DIR = getPath("logs");
const LOG_FILE = path.join(LOG_DIR, "app.log");
const MAX_SIZE = 100 * 1024 * 1024 * 1024; // 100GB - 避免频繁触发轮转阻塞事件循环
const LEVELS: LogLevel[] = ["log", "info", "warn", "error", "debug"];

class Logger {
  private stream: fs.WriteStream | null = null;
  private genStream: fs.WriteStream | null = null;
  private genDate: string = "";
  private originalConsole: Partial<Record<LogLevel, ConsoleMethod>> = {};
  private originalStdoutWrite: typeof process.stdout.write | null = null;
  private originalStderrWrite: typeof process.stderr.write | null = null;
  private isHijacked = false;

  init(): this {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    this.stream = fs.createWriteStream(LOG_FILE, { flags: "a" });
    this.ensureGenStream();
    // 劫持 console / stdout / stderr 写入文件
    this.hijack();
    return this;
  }

  /** 确保生成日志流按日期切换 */
  private ensureGenStream(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.genDate !== today) {
      this.genStream?.end();
      const genFile = path.join(LOG_DIR, `generation-${today}.log`);
      this.genStream = fs.createWriteStream(genFile, { flags: "a" });
      this.genDate = today;
    }
  }

  /** 写入结构化生成日志 (JSON lines) */
  genLog(entry: Record<string, unknown>): void {
    this.ensureGenStream();
    const logLine = JSON.stringify({
      time: this.formatTime(),
      ...entry,
    }) + "\n";
    if (this.genStream && !this.genStream.destroyed) {
      this.genStream.write(logLine);
    }
  }

  private formatTime(): string {
    const d = new Date();
    const p = (n: number, l = 2) => String(n).padStart(l, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(
      d.getMilliseconds(),
      3,
    )}`;
  }

  private stringify(arg: unknown): string {
    if (arg == null) return String(arg);
    if (arg instanceof Error) return `${arg.message}\n${arg.stack || ""}`;
    if (typeof arg === "object") {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }

  private writing = false;

  private write(level: LogLevel, args: unknown[]): void {
    const line = `[${this.formatTime()}] [${level.toUpperCase()}] ${args.map((a) => this.stringify(a)).join(" ")}\n`;
    if (this.stream && !this.stream.destroyed) this.stream.write(line);
    this.checkRotate();
  }

  private writeRaw(chunk: any): void {
    if (this.writing) return;
    this.writing = true;
    try {
      let str = typeof chunk === "string" ? chunk : chunk?.toString?.("utf-8") ?? "";
      str = str.replace(/\x1B\[\d*m/g, ""); // 去除 ANSI 颜色码
      if (str.trim() && this.stream && !this.stream.destroyed) this.stream.write(str.endsWith("\n") ? str : str + "\n");
    } finally {
      this.writing = false;
    }
  }

  private rotateCounter = 0;

  private checkRotate(): void {
    // 每 100 次写操作检查一次文件大小，避免频繁 stat
    this.rotateCounter++;
    if (this.rotateCounter % 100 !== 0) return;
    try {
      if (!fs.existsSync(LOG_FILE) || fs.statSync(LOG_FILE).size < MAX_SIZE) return;
      // 异步轮转：重命名旧文件并创建新流，避免同步读取大文件阻塞事件循环
      this.stream?.end();
      const renamed = LOG_FILE + "." + Date.now();
      fs.renameSync(LOG_FILE, renamed);
      this.stream = fs.createWriteStream(LOG_FILE, { flags: "a" });
      // 后台删除旧文件
      fs.unlink(renamed, () => {});
    } catch {}
  }

  private hijack(): void {
    if (this.isHijacked) return;
    // 劫持 console 方法
    for (const level of LEVELS) {
      const original = console[level];
      if (typeof original !== "function") continue;
      this.originalConsole[level] = original.bind(console);
      (console as any)[level] = (...args: unknown[]) => {
        this.writing = true;
        try {
          this.write(level, args);
        } catch (err) {
          this.originalConsole.error?.("[Logger Error]", err);
        }
        this.writing = false;

        this.originalConsole[level]!(...args);
      };
    }

    // 劫持 stdout/stderr（捕获 morgan 等直接写 stdout 的输出）
    this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
    this.originalStderrWrite = process.stderr.write.bind(process.stderr);

    process.stdout.write = ((chunk: any, ...rest: any[]) => {
      this.writeRaw(chunk);
      return this.originalStdoutWrite!(chunk, ...rest);
    }) as typeof process.stdout.write;

    process.stderr.write = ((chunk: any, ...rest: any[]) => {
      this.writeRaw(chunk);
      return this.originalStderrWrite!(chunk, ...rest);
    }) as typeof process.stderr.write;

    this.isHijacked = true;
  }

  /** 导出日志内容 */
  exportLogs(): string {
    if (!fs.existsSync(LOG_FILE)) return "";
    return fs.readFileSync(LOG_FILE, "utf-8");
  }

  /** 清空日志 */
  clear(): void {
    this.stream?.end();
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
    this.stream = fs.createWriteStream(LOG_FILE, { flags: "a" });
  }

  /** 关闭日志 */
  close(): void {
    if (this.isHijacked) {
      for (const level of LEVELS) {
        const original = this.originalConsole[level];
        if (original) (console as any)[level] = original;
      }
      this.originalConsole = {};
      if (this.originalStdoutWrite) process.stdout.write = this.originalStdoutWrite;
      if (this.originalStderrWrite) process.stderr.write = this.originalStderrWrite;
      this.originalStdoutWrite = null;
      this.originalStderrWrite = null;
      this.isHijacked = false;
    }
    this.stream?.end();
    this.stream = null;
  }
}

const logger = new Logger().init();
export default logger;
