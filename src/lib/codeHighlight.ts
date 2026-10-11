import protobuf from "highlight.js/lib/languages/protobuf";
import { common } from "lowlight";

/**
 * 语言表：lowlight 的 common（37 种）再补一个 protobuf。
 *
 * 一开始写的是「按需精简」，只挑站点用得到的十几种，想省体积——实测恰好相反。
 * 从 highlight.js/lib/languages/* 逐个引入会各自带进模块包装代码，引两种
 * （bash + yaml）就比全部 37 种还大 4.7 KB，引十二种大 32 KB；而 common 是
 * 一次打包好的整体，minifier 能跨模块合并常量。所以这里用 common。
 *
 * 顺带的好处：以后写任何常见语言都不必回来改这张表。common 唯独没有 protobuf，
 * 而 k8s 那几篇正好用到了。
 */
const LANGUAGES = { ...common, protobuf };

/**
 * 别名表：正名 -> 别名。
 *
 * 不必为大小写做任何事——highlight.js 匹配语言名时不区分大小写，`Bash`、`YAML`、
 * `TypeScript` 都能认。真正要补的是它没定义的那几个写法：`plain` 不是 plaintext
 * 的别名，不注册就会静默退成纯文本。common 已经带了 sh/zsh、yml、text/txt，
 * 这里只补它缺的。
 */
const ALIASES: Record<string, string[]> = {
  plaintext: ["plain", "none"],
};

export const highlightLanguages = LANGUAGES;
export const highlightAliases = ALIASES;

const warned = new Set<string>();

/**
 * 开发期提示：代码块标注的语言 highlight.js 不认识。
 *
 * 必须挂在 rehype-highlight **之后**。查不到语言时它是静默跳过、不报错的，只把一条
 * ruleId 为 `missing-language` 的消息记在 VFile 上，浏览器里根本看不到——这正是
 * 「按语言高亮」最容易悄悄失效的地方。读它的消息，比自己去维护一份语言表可靠，
 * 也不会因为抄一份而走样。线上不跑，免得刷控制台。
 */
export function rehypeWarnUnknownLanguage() {
  return (_tree: unknown, file: { messages: VFileMessageLike[] }) => {
    if (!import.meta.env.DEV) return;

    for (const message of file.messages) {
      if (message.ruleId !== "missing-language") continue;
      const lang = /`([^`]+)`/.exec(message.reason ?? "")?.[1] ?? "未知";
      if (warned.has(lang)) continue;
      warned.add(lang);
      console.warn(
        `[code-highlight] 语言「${lang}」未注册，该代码块会按纯文本渲染。` +
          `需要高亮的话，在 src/lib/codeHighlight.ts 的 LANGUAGES 里补上。`,
      );
    }
  };
}

/** 只用到 VFileMessage 的一点点字段，不必为它拉一个类型依赖 */
interface VFileMessageLike {
  ruleId?: string | null;
  reason?: string;
}
