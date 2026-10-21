TypeScript 的尴尬之处在于：**语法看起来像 Java，运行时却还是 JavaScript。** 类型只在编译期存在，编译后被完全擦除；它不能防止 `JSON.parse` 返回脏数据，也不能保证接口真的返回你声明的形状。

所以学 TypeScript 要同时建立两条认知：

1. **类型系统能做什么**：描述数据形状、约束函数、在编译期发现错误、让 IDE 提供补全和重构
2. **类型系统不能做什么**：运行时校验、防止 `as` 撒谎、阻止 `any` 传染、替代测试

这篇文章从基础语法讲到高级类型，再到工程配置和类型安全实践。重点不是把 20 个工具类型背下来，而是知道**什么时候该用哪种类型工具，以及它们的边界在哪里**。

![TypeScript 类型系统分层：基础类型与字面量、联合与交叉、泛型与索引访问、条件类型与映射类型、模板字面量类型，最终服务于工程约束和运行时校验](/images/blog/typescript-syntax-advanced/type-system.svg)

# 一、先建立正确的心智模型

## 1.1 类型是编译期的约束

```typescript
const user: { name: string; age: number } = { name: "Alice", age: 30 };
```

编译后，类型注解全部消失，运行时就是：

```javascript
const user = { name: "Alice", age: 30 };
```

这意味着：

- 类型错误在编译期报，运行时不会「检查类型」
- 从网络、文件、`JSON.parse`、`localStorage` 来的数据，类型断言只是**你向编译器保证**，不是事实
- 边界数据必须做运行时校验（zod、valibot、io-ts、手写 guard）

## 1.2 结构化类型（Structural Typing）

TypeScript 是结构化类型系统：**只要形状兼容，就认为是同一类型**，不要求显式继承。

```typescript
interface Point {
  x: number;
  y: number;
}

function print(p: Point) {
  console.log(p.x, p.y);
}

const p = { x: 1, y: 2, z: 3 };
print(p); // OK：多出的 z 不影响兼容性
```

但对象字面量会触发**多余属性检查**：

```typescript
print({ x: 1, y: 2, z: 3 });
// Error: Object literal may only specify known properties
```

这是 TypeScript 的一个「善意谎言」：通过变量传入允许多余属性，直接写字面量则不允许，目的是尽早发现拼写错误。

## 1.3 `any`、`unknown`、`never`

| 类型 | 含义 | 使用建议 |
| --- | --- | --- |
| `any` | 关闭类型检查，可赋给任何类型 | 尽量避免；会传染 |
| `unknown` | 未知类型，使用前必须收窄 | 外部输入的默认类型 |
| `never` | 不可能出现的值 | 穷尽检查、抛出异常的函数 |
| `void` | 无返回值 | 事件回调、副作用函数 |
| `undefined` / `null` | 空值 | 开启 `strictNullChecks` 后与具体类型区分 |

```typescript
function parse(input: unknown) {
  // input.trim(); // Error: unknown 不能直接使用
  if (typeof input === "string") {
    return input.trim(); // 收窄为 string
  }
  throw new Error("not a string");
}

function assertNever(value: never): never {
  throw new Error(`unexpected value: ${JSON.stringify(value)}`);
}
```

**`unknown` 是外部数据的正确入口类型**。`fetch().json()` 在 TypeScript 里返回 `any`，你可以立即把它标成 `unknown`，再做校验。

# 二、基础语法速览

## 2.1 基本类型

```typescript
let name: string = "Alice";
let age: number = 30;
let active: boolean = true;
let big: bigint = 10n;
let sym: symbol = Symbol("id");
let nothing: null = null;
let missing: undefined = undefined;

let names: string[] = ["a", "b"];
let tuple: [number, string] = [1, "a"];
let readonlyTuple: readonly [number, string] = [1, "a"] as const;
```

## 2.2 interface 与 type

| 维度 | `interface` | `type` |
| --- | --- | --- |
| 对象形状 | ✓ | ✓ |
| 联合类型 | ✗ | ✓ |
| 交叉类型 | 通过 `extends` | 通过 `&` |
| 映射类型 | ✗ | ✓ |
| 条件类型 | ✗ | ✓ |
| 声明合并 | ✓（同名 interface 合并） | ✗ |
| 实现/继承 | `implements` / `extends` | 对象类型可 `implements` |
| 性能 | 通常更好（可缓存） | 复杂类型可能更慢 |

```typescript
interface User {
  id: string;
  name: string;
  email?: string;
}

type Status = "pending" | "paid" | "cancelled";

type UserWithStatus = User & { status: Status };
```

**经验法则**：

- 描述对象/类的公开形状 → `interface`
- 联合、映射、条件、工具类型 → `type`
- 需要声明合并（如扩展第三方库）→ `interface`
- 不需要纠结「哪个更好」，团队统一即可

## 2.3 联合、交叉、字面量

```typescript
type ID = string | number;
type Admin = User & { permissions: string[] };
type Direction = "up" | "down" | "left" | "right";
type Mode = "light" | "dark";
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };
```

字面量联合是**最轻量的枚举**，比 `enum` 更推荐：

```typescript
type OrderStatus = "created" | "paid" | "shipped" | "cancelled";

function next(status: OrderStatus): OrderStatus {
  switch (status) {
    case "created": return "paid";
    case "paid": return "shipped";
    case "shipped":
    case "cancelled": return status;
    default: return assertNever(status);
  }
}
```

## 2.4 函数类型

```typescript
type Handler = (event: Event) => void;
type AsyncHandler = (event: Event) => Promise<void>;
type Comparator<T> = (a: T, b: T) => number;

function map<T, U>(items: T[], fn: (item: T) => U): U[] {
  return items.map(fn);
}

// 可选参数、默认参数、剩余参数
function greet(name: string, title = "Mr.", ...suffixes: string[]): string {
  return `${title} ${name}${suffixes.join("")}`;
}

// 重载
function parse(value: string): number;
function parse(value: number): string;
function parse(value: string | number): string | number {
  return typeof value === "string" ? Number(value) : String(value);
}
```

## 2.5 可选、只读、索引签名

```typescript
interface Config {
  readonly apiUrl: string;
  timeout?: number;             // number | undefined
  headers: Record<string, string>;
}

const config: Config = {
  apiUrl: "https://api.example.com",
  headers: { "Content-Type": "application/json" },
};

// config.apiUrl = "x"; // Error: readonly
```

注意：`timeout?: number` 在默认配置下表示 `number | undefined`，但**属性可以不存在**。开启 `exactOptionalPropertyTypes` 后，`{ timeout: undefined }` 与「没有 timeout」会被区分开。

## 2.6 enum 的坑

```typescript
enum Status {
  Pending,  // 0
  Paid,     // 1
  Done,     // 2
}

enum Color {
  Red = "red",
  Blue = "blue",
}
```

`enum` 会生成运行时对象，数字枚举还有反向映射（`Status[0] === "Pending"`）。坑包括：

- 数字枚举可以接受任意 number，类型不安全
- `const enum` 在 `isolatedModules` / Babel / esbuild 下行为受限
- 与后端协议对齐时，字符串枚举不如字面量联合直观
- `enum` 是少数会生成运行时代码的类型语法

**推荐**：

```typescript
const OrderStatus = {
  Created: "created",
  Paid: "paid",
  Shipped: "shipped",
} as const;

type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];
// "created" | "paid" | "shipped"
```

既有运行时对象，又有字面量联合类型，且没有 enum 的历史包袱。

# 三、类型收窄：把宽类型变窄

TypeScript 的控制流分析会根据条件自动收窄类型。

## 3.1 typeof / instanceof / in

```typescript
function format(value: string | number | Date) {
  if (typeof value === "string") {
    return value.toUpperCase();
  }
  if (typeof value === "number") {
    return value.toFixed(2);
  }
  return value.toISOString(); // Date
}

function handle(error: unknown) {
  if (error instanceof Error) {
    console.log(error.message);
  }
}

type A = { a: string };
type B = { b: number };

function f(value: A | B) {
  if ("a" in value) {
    return value.a;
  }
  return value.b;
}
```

## 3.2 可辨识联合（Discriminated Union）

```typescript
type Result<T> =
  | { type: "success"; data: T }
  | { type: "error"; error: Error }
  | { type: "loading" };

function render<T>(result: Result<T>) {
  switch (result.type) {
    case "success":
      return result.data;       // 收窄到 success
    case "error":
      return result.error;      // 收窄到 error
    case "loading":
      return null;
    default:
      return assertNever(result); // 穷尽检查
  }
}
```

这是 TypeScript 里**最实用的模式**，特别适合状态机、API 响应、Redux action、React 组件 props。

## 3.3 自定义类型守卫

```typescript
interface Cat { meow(): void }
interface Dog { bark(): void }

function isCat(animal: Cat | Dog): animal is Cat {
  return (animal as Cat).meow !== undefined;
}

function speak(animal: Cat | Dog) {
  if (isCat(animal)) {
    animal.meow(); // 收窄为 Cat
  } else {
    animal.bark(); // Dog
  }
}
```

`value is T` 是**你向编译器保证**的谓词；运行时是否真的成立，要自己写对。

## 3.4 断言函数

```typescript
function assertIsString(value: unknown): asserts value is string {
  if (typeof value !== "string") {
    throw new TypeError("value must be a string");
  }
}

function f(input: unknown) {
  assertIsString(input);
  input.toUpperCase(); // 收窄为 string
}
```

断言函数适合在入口处校验参数，失败直接抛错。

## 3.5 穷尽检查

```typescript
function assertNever(value: never): never {
  throw new Error(`unhandled value: ${JSON.stringify(value)}`);
}
```

当联合类型新增成员时，`switch` 的 `default` 分支会编译报错，强制你处理新情况。这是**用类型系统做变更保护**的典型手段。

![TypeScript 类型收窄决策：unknown 通过 typeof、instanceof、in、可辨识联合、自定义守卫逐步缩小范围，最后用 never 做穷尽检查](/images/blog/typescript-syntax-advanced/narrowing.svg)

# 四、泛型：类型的参数化

## 4.1 基本用法

```typescript
function identity<T>(value: T): T {
  return value;
}

function first<T>(items: T[]): T | undefined {
  return items[0];
}

interface Box<T> {
  value: T;
}

class Stack<T> {
  private items: T[] = [];
  push(item: T) { this.items.push(item); }
  pop(): T | undefined { return this.items.pop(); }
}
```

## 4.2 约束与默认值

```typescript
function pluck<T, K extends keyof T>(items: T[], key: K): T[K][] {
  return items.map((item) => item[key]);
}

const users = [{ id: 1, name: "Alice" }];
const names = pluck(users, "name"); // string[]
const ids = pluck(users, "id");     // number[]

interface ApiResponse<T = unknown> {
  data: T;
  error?: string;
}

function get<T extends { id: string }>(id: string): Promise<T> {
  // ...
}
```

## 4.3 泛型推导

```typescript
function createPair<T, U>(first: T, second: U): [T, U] {
  return [first, second];
}

const pair = createPair(1, "a"); // [number, string]

// 显式指定
const pair2 = createPair<number, string>(1, "a");
```

TypeScript 通常能从参数推导泛型；推导不出来或需要更精确时再显式指定。

## 4.4 keyof 与索引访问

```typescript
type User = {
  id: string;
  name: string;
  age: number;
};

type UserKeys = keyof User;            // "id" | "name" | "age"
type UserName = User["name"];          // string
type UserValues = User[keyof User];    // string | number

function get<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
```

## 4.5 泛型组件（React）

```typescript
type ListProps<T> = {
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  keyExtractor: (item: T) => string;
};

function List<T>({ items, renderItem, keyExtractor }: ListProps<T>) {
  return (
    <ul>
      {items.map((item) => (
        <li key={keyExtractor(item)}>{renderItem(item)}</li>
      ))}
    </ul>
  );
}
```

# 五、高级类型

## 5.1 条件类型与 infer

```typescript
type IsString<T> = T extends string ? true : false;

type ElementType<T> = T extends (infer U)[] ? U : never;

type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

type Return<T> = T extends (...args: any[]) => infer R ? R : never;

type A = ElementType<string[]>;        // string
type B = UnwrapPromise<Promise<number>>; // number
type C = Return<() => void>;           // void
```

**分布式条件类型**：当 `T` 是裸类型参数且传入联合类型时，条件类型会分配到每个成员：

```typescript
type ToArray<T> = T extends any ? T[] : never;
type R = ToArray<string | number>; // string[] | number[]

// 阻止分配：用元组包一层
type ToArrayNonDist<T> = [T] extends [any] ? T[] : never;
type R2 = ToArrayNonDist<string | number>; // (string | number)[]
```

`infer` 还可以带约束（TS 4.7+）：

```typescript
type FirstString<T> = T extends [infer S extends string, ...unknown[]] ? S : never;
```

## 5.2 映射类型

```typescript
type Mutable<T> = {
  -readonly [K in keyof T]: T[K];
};

type Optional<T> = {
  [K in keyof T]?: T[K];
};

type Nullable<T> = {
  [K in keyof T]: T[K] | null;
};

// key remapping（TS 4.1+）
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

type UserGetters = Getters<{ name: string; age: number }>;
// { getName: () => string; getAge: () => number }
```

映射类型是工具类型的底层实现，理解它就能自己造工具类型。

## 5.3 模板字面量类型

```typescript
type EventName = "click" | "focus" | "blur";
type HandlerName = `on${Capitalize<EventName>}`;
// "onClick" | "onFocus" | "onBlur"

type Route = `/users/${string}` | `/orders/${number}`;

type ApiPath<T extends string> = `/api/${T}`;
type UserPath = ApiPath<"users" | "orders">;
// "/api/users" | "/api/orders"
```

模板字面量类型适合描述事件名、CSS 属性、路由、i18n key 等有规律拼接的字符串。

## 5.4 常用工具类型

| 工具类型 | 作用 | 示例 |
| --- | --- | --- |
| `Partial<T>` | 所有属性可选 | `Partial<User>` |
| `Required<T>` | 所有属性必填 | `Required<Config>` |
| `Readonly<T>` | 所有属性只读 | `Readonly<User>` |
| `Pick<T, K>` | 选取部分属性 | `Pick<User, "id" \| "name">` |
| `Omit<T, K>` | 排除部分属性 | `Omit<User, "password">` |
| `Record<K, V>` | 构造键值对象 | `Record<string, number>` |
| `Exclude<T, U>` | 从联合中排除 | `Exclude<"a"\|"b", "a">` → `"b"` |
| `Extract<T, U>` | 从联合中提取 | `Extract<"a"\|"b", "b">` → `"b"` |
| `NonNullable<T>` | 排除 null/undefined | `NonNullable<string \| null>` |
| `ReturnType<F>` | 函数返回类型 | `ReturnType<typeof fn>` |
| `Parameters<F>` | 函数参数元组 | `Parameters<typeof fn>` |
| `Awaited<T>` | 递归解包 Promise | `Awaited<Promise<number>>` |
| `InstanceType<C>` | 构造器实例类型 | `InstanceType<typeof User>` |

## 5.5 `satisfies`：校验但不改变类型

```typescript
const config = {
  apiUrl: "https://api.example.com",
  timeout: 5000,
} satisfies Config;
```

和 `const config: Config = ...` 的区别：

- 注解会**拓宽**类型，`config.timeout` 变成 `number | undefined`
- `satisfies` 保留字面量类型，`config.timeout` 仍是 `5000`，同时检查是否符合 `Config`

和 `as` 的区别：

- `as` 是**断言**，可能撒谎，不检查兼容性
- `satisfies` 是**校验**，不兼容会报错

```typescript
const routes = {
  home: "/",
  user: "/users/:id",
} satisfies Record<string, `/` | `/users/${string}`>;

routes.home; // 类型仍是 "/"
```

## 5.6 `as const`

```typescript
const statuses = ["created", "paid", "shipped"] as const;
// readonly ["created", "paid", "shipped"]

type Status = (typeof statuses)[number];
// "created" | "paid" | "shipped"
```

`as const` 把字面量收窄为只读字面量类型，适合配置表、常量数组、枚举替代。

## 5.7 品牌类型（Branded Types）

TypeScript 的结构化类型无法区分「都是 string 的 UserId 和 OrderId」：

```typescript
type UserId = string;
type OrderId = string;

function getUser(id: UserId) { /* ... */ }
getUser(orderId); // 编译通过，但语义错误
```

用品牌类型做名义化：

```typescript
declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

type UserId = Brand<string, "UserId">;
type OrderId = Brand<string, "OrderId">;

function asUserId(value: string): UserId {
  return value as UserId;
}

function getUser(id: UserId) { /* ... */ }

getUser(orderId); // Error
getUser(asUserId("u_1")); // OK
```

品牌类型适合 ID、金额、邮箱、URL 等「底层类型相同但语义不同」的场景。代价是构造时需要断言，通常配合校验函数使用。

## 5.8 变型（Variance）

TypeScript 是结构化类型，默认对属性做协变检查，对方法参数做双变检查（在 `strictFunctionTypes` 下函数参数是逆变）。

```typescript
type Animal = { name: string };
type Dog = Animal & { bark(): void };

let animal: Animal = { name: "a" };
let dog: Dog = { name: "d", bark() {} };

animal = dog; // OK：Dog 可赋给 Animal（协变）
// dog = animal; // Error
```

泛型在 TS 4.7+ 支持显式变型标注：

```typescript
interface Producer<out T> {
  get(): T;
}

interface Consumer<in T> {
  set(value: T): void;
}
```

大多数业务代码不需要手写变型，理解「子类型可以替代父类型」即可。

# 六、工程配置：让类型真正发挥作用

## 6.1 必开的 strict 选项

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

| 选项 | 作用 |
| --- | --- |
| `strict` | 打开 strictNullChecks、strictFunctionTypes、noImplicitAny 等 |
| `noUncheckedIndexedAccess` | `arr[i]` 视为 `T \| undefined`，避免越界 |
| `exactOptionalPropertyTypes` | 区分「属性缺失」和「属性为 undefined」 |
| `noImplicitOverride` | 重写父类方法必须写 `override` |
| `noFallthroughCasesInSwitch` | switch 分支不能意外贯穿 |
| `useUnknownInCatchVariables` | `catch (e)` 的 `e` 是 `unknown`，必须收窄 |

这些选项会让代码更啰嗦，但能把大量运行时错误提前到编译期。

## 6.2 模块与构建

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true
  }
}
```

| 选项 | 说明 |
| --- | --- |
| `moduleResolution: "Bundler"` | 适合 Vite/webpack 等打包器 |
| `verbatimModuleSyntax` | 强制 `import type`，避免类型导入被当作运行时导入 |
| `isolatedModules` | 兼容 Babel/esbuild 的单文件编译 |
| `skipLibCheck` | 跳过 `.d.ts` 检查，加快构建（不能替代业务代码检查） |
| `noEmit` | 只做类型检查，产物交给打包器 |

**类型导入要显式**：

```typescript
import type { User } from "./types";
import { getUser } from "./api";
```

这样打包器可以安全地擦除类型导入，不会因为「导入了一个只导出类型的模块」而产生运行时错误。

## 6.3 声明文件与模块扩展

```typescript
// global.d.ts
declare global {
  interface Window {
    __APP_VERSION__: string;
  }
}

export {};

// 扩展第三方模块
declare module "some-lib" {
  interface Options {
    custom?: string;
  }
}
```

声明合并主要用于：

- 给全局对象加属性
- 扩展第三方库的类型
- 给非 JS 资源（`.svg`、`.css`）声明模块

## 6.4 路径别名

```jsonc
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

别忘了打包器（Vite/webpack/ts-node）也要配置同样的 alias，否则编译能过、运行时找不到模块。

# 七、类型安全实践

## 7.1 边界必须做运行时校验

```typescript
import { z } from "zod";

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  age: z.number().int().nonnegative(),
});

type User = z.infer<typeof UserSchema>;

async function fetchUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  const json: unknown = await response.json();
  return UserSchema.parse(json); // 运行时校验 + 类型收窄
}
```

**类型断言不是校验**：

```typescript
const data = (await response.json()) as User; // 可能撒谎
```

如果接口返回了 `{ id: 1 }`，`as User` 依然编译通过，运行时 `data.name` 是 `undefined`。

## 7.2 避免 `any`，用 `unknown` + 收窄

```typescript
// 反例
function handle(data: any) {
  return data.user.name; // 运行时可能崩溃
}

// 正例
function handle(data: unknown) {
  if (!isRecord(data)) throw new Error("invalid data");
  const user = data.user;
  if (!isRecord(user) || typeof user.name !== "string") {
    throw new Error("invalid user");
  }
  return user.name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
```

## 7.3 用可辨识联合表达状态

```typescript
type RequestState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: Error };

function View<T>({ state }: { state: RequestState<T> }) {
  switch (state.status) {
    case "idle": return <Empty />;
    case "loading": return <Spinner />;
    case "success": return <Data data={state.data} />;
    case "error": return <ErrorView error={state.error} />;
    default: return assertNever(state);
  }
}
```

比 `{ loading: boolean; data?: T; error?: Error }` 安全得多：不可能同时处于 loading 和 success，也不会出现「有 error 但没 data」的非法组合。

## 7.4 DTO 与领域模型分离

```typescript
// 接口返回的原始形状
interface UserDto {
  id: string;
  user_name: string;
  created_at: string;
}

// 应用内部模型
interface User {
  id: UserId;
  name: string;
  createdAt: Date;
}

function toUser(dto: UserDto): User {
  return {
    id: asUserId(dto.id),
    name: dto.user_name,
    createdAt: new Date(dto.created_at),
  };
}
```

不要把后端 DTO 直接当领域模型用：字段命名、类型、空值语义都可能不同，转换层是类型安全的一部分。

## 7.5 React + TypeScript

```typescript
// 泛型组件
type SelectProps<T> = {
  options: T[];
  value: T;
  onChange: (value: T) => void;
  getLabel: (value: T) => string;
};

function Select<T>({ options, value, onChange, getLabel }: SelectProps<T>) {
  return (
    <select
      value={getLabel(value)}
      onChange={(e) => {
        const next = options.find((o) => getLabel(o) === e.target.value);
        if (next) onChange(next);
      }}
    >
      {options.map((o) => (
        <option key={getLabel(o)}>{getLabel(o)}</option>
      ))}
    </select>
  );
}

// 互斥 props
type AlertProps =
  | { type: "success"; message: string }
  | { type: "error"; message: string; retry: () => void };

function Alert(props: AlertProps) {
  if (props.type === "error") {
    props.retry(); // 只有 error 分支有 retry
  }
}
```

# 八、常见坑

| 坑 | 说明 | 正确做法 |
| --- | --- | --- |
| `any` 传染 | 一个 `any` 会让整条链路失去检查 | 用 `unknown`，在边界收窄 |
| `as` 当校验 | 断言不检查运行时数据 | zod/valibot/手写 guard |
| `JSON.parse` 返回 `any` | 后续访问没有类型保护 | 立即标成 `unknown` 并校验 |
| `Object.keys(obj)` 返回 `string[]` | 不是 `(keyof T)[]` | 用 `Object.keys(obj) as (keyof T)[]` 或封装 helper |
| 数组 `includes` 类型不匹配 | `string[]` 不能收窄字面量 | 用 `as const` 元组，或 `readonly string[]` |
| 可选属性 vs `undefined` | `exactOptionalPropertyTypes` 下语义不同 | 明确「缺失」和「显式 undefined」 |
| 结构化类型允许额外属性 | 变量传入不触发多余属性检查 | 关键对象做运行时校验 |
| enum 运行时对象 | 与后端协议、树摇、isolatedModules 冲突 | 字面量联合 + `as const` 对象 |
| `Record<string, T>` 过于宽松 | 任意 key 都存在 | 用具体 key 联合或 `Partial<Record<...>>` |
| 类型只在编译期 | 不能防脏数据 | 边界校验 + 测试 |
| `skipLibCheck` 掩盖依赖类型错误 | 第三方 `.d.ts` 问题被忽略 | 定期单独检查依赖 |
| 路径别名只配了 tsconfig | 运行时找不到模块 | 打包器同步配置 |

# 九、20 道高频面试题

**Q1：TypeScript 的类型在运行时存在吗？**

不存在。类型在编译后被擦除，运行时是纯 JavaScript。`as`、泛型、接口都不会产生运行时检查，外部数据必须做运行时校验。

**Q2：`interface` 和 `type` 的区别？**

都能描述对象。`interface` 支持声明合并、更适合公开 API；`type` 能表达联合、交叉、映射、条件、模板字面量等。选择看需求，不必迷信某一个。

**Q3：`any` 和 `unknown` 的区别？**

`any` 关闭类型检查，可赋给任何类型，会传染；`unknown` 是安全的上层类型，使用前必须收窄。外部输入优先用 `unknown`。

**Q4：`never` 有什么用？**

表示不可能的值，用于穷尽检查、抛出异常的函数、不可能的分支。联合类型新增成员时，`assertNever` 会让编译报错。

**Q5：什么是结构化类型？**

只要对象形状兼容就视为同一类型，不要求显式继承。这是 TypeScript 与 Java/C# 名义类型系统的重要区别。

**Q6：什么是类型收窄？**

通过 `typeof`、`instanceof`、`in`、可辨识联合、自定义守卫等，把宽类型缩小为具体类型。控制流分析会自动完成大部分收窄。

**Q7：可辨识联合是什么？**

联合的每个成员都有一个共同的字面量字段（如 `type`/`status`），通过判断该字段可以收窄到具体成员。适合状态机、API 响应、组件 props。

**Q8：`is` 类型守卫和 `as` 断言的区别？**

`value is T` 用于函数返回值，告诉编译器「如果返回 true，value 就是 T」，通常配合运行时检查；`as` 是直接断言，不做运行时检查，可能撒谎。

**Q9：泛型约束怎么写？**

`T extends U`，例如 `K extends keyof T`、`T extends { id: string }`。约束让泛型内部可以安全访问特定属性/方法。

**Q10：`keyof` 和 `typeof` 的区别？**

`keyof T` 取类型 T 的键联合；`typeof value` 取值的类型。常组合使用：`keyof typeof obj` 取对象的键联合。

**Q11：条件类型是什么？**

`T extends U ? X : Y`，根据类型关系在编译期选择类型。配合 `infer` 可以提取类型（如 `ReturnType`、`Awaited`）。

**Q12：什么是分布式条件类型？**

当条件类型作用于裸类型参数且传入联合类型时，会分配到每个成员。用 `[T] extends [U]` 可以阻止分配。

**Q13：映射类型是什么？**

`{ [K in keyof T]: ... }`，对类型的每个属性做变换。`Partial`、`Required`、`Readonly`、`Pick` 等都是映射类型的应用。

**Q14：`satisfies` 和 `as`、类型注解有什么区别？**

`satisfies` 校验值是否符合类型，但保留值的精确类型；类型注解会拓宽类型；`as` 是断言，不做检查。`satisfies` 适合配置对象。

**Q15：`as const` 有什么用？**

把字面量收窄为只读字面量类型，常用于常量数组/对象，配合 `typeof` 生成联合类型，替代 enum。

**Q16：什么是品牌类型？**

用交叉类型加唯一 symbol 标记，让底层类型相同但语义不同的类型不能互相赋值（UserId vs OrderId）。代价是构造时需要断言/校验。

**Q17：`Partial<T>` 和 `?` 可选属性有什么区别？**

`Partial<T>` 是映射类型，把 T 的所有属性变可选；`?` 是属性声明。两者结果相似，但 `Partial` 可以作用于已有类型，且受 `exactOptionalPropertyTypes` 影响。

**Q18：`Record<string, T>` 有什么风险？**

它声称任意 string key 都存在，读取不存在的 key 也返回 T，容易掩盖运行时 undefined。更精确的做法是用具体 key 联合，或 `Partial<Record<K, T>>`。

**Q19：为什么 `Object.keys` 不返回 `(keyof T)[]`？**

因为对象在运行时可能有额外属性，TypeScript 选择更安全的 `string[]`。需要精确类型时用 `as (keyof T)[]` 或封装 helper，并确保对象形状受控。

**Q20：如何保证接口返回的数据类型安全？**

类型断言不够。要在边界做运行时校验（zod/valibot/typebox/手写 guard），校验通过后再转成领域模型；同时处理网络错误、空响应和字段缺失。

# 十、速查表

## 10.1 类型工具

```text
取键          keyof T
取值类型      typeof value
索引访问      T[K]
联合          A | B
交叉          A & B
条件          T extends U ? X : Y
提取          T extends Promise<infer U> ? U : T
映射          { [K in keyof T]: ... }
键重映射      { [K in keyof T as `get${Capitalize<K>}`]: ... }
模板字面量    `on${Capitalize<Event>}`
只读          as const / Readonly<T>
校验          satisfies
```

## 10.2 类型收窄

```text
typeof value === "string"
value instanceof Error
"key" in value
switch (value.type)          // 可辨识联合
isString(value)              // value is string
assertIsString(value)        // asserts value is string
assertNever(value)           // 穷尽检查
```

## 10.3 工程检查清单

```text
□ strict: true
□ noUncheckedIndexedAccess
□ exactOptionalPropertyTypes
□ useUnknownInCatchVariables
□ import type / verbatimModuleSyntax
□ 外部数据运行时校验（zod/valibot）
□ 避免 any，边界用 unknown
□ 用可辨识联合表达状态
□ DTO 与领域模型分离
□ 路径别名在 tsconfig 和打包器都配置
□ 不用 as 代替校验
□ 关键 ID 用品牌类型
```

---

TypeScript 的价值不在于「写更多类型」，而在于**把不可能的状态变得不可表达**：

- 用可辨识联合，让「loading 和 success 同时为真」不可能
- 用品牌类型，让「把 OrderId 传给 UserId」不可能
- 用 `never` 穷尽检查，让「新增状态忘了处理」不可能
- 用运行时校验，让「类型声明与真实数据不一致」尽早暴露

类型是给编译器和未来的自己看的。**好的类型设计，是让错误在写代码时就发生，而不是在线上才发生。**
