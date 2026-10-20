设计模式大概是技术面试里最「看起来会、一问就露馅」的 topic。背出 23 个名字不难，难的是回答三个追问：**它解决了什么变化？不用它会怎样？什么时候不该用它？**

这篇文章不打算把 23 个模式写成 23 段定义。那样看完还是不会用。我们按「**问题 → 结构 → 代码 → 代价**」来讲，重点放在模式之间的边界、常见误用，以及它们在现代框架里的真实形态——Spring、JDK、React 里到处都有模式，只是没人举着牌子告诉你。

![设计模式的三大分类：创建型关注对象怎么产生，结构型关注对象怎么组合，行为型关注对象之间怎么协作](/images/blog/design-patterns/pattern-map.svg)

# 一、模式之前：先找到变化点

## 1.1 设计模式的本质

所有设计模式都在做同一件事：**把「会变的部分」从「不变的部分」里分离出来，用抽象隔开。**

- 策略模式把「算法」从「调用流程」里分离
- 工厂模式把「创建哪个对象」从「使用对象」里分离
- 观察者把「状态变化」和「后续反应」分离
- 装饰器把「核心功能」和「可叠加的附加功能」分离

所以判断该不该上模式，只问一句：**这里有一个明确的变化点吗？** 没有变化点，抽象就是纯成本。

## 1.2 先记住五条原则，再记模式

设计模式是原则的产物，不是反过来。

| 原则 | 一句话 | 对应到模式 |
| --- | --- | --- |
| **S** 单一职责 | 一个类只因为一个原因变化 | 几乎全部 |
| **O** 开闭原则 | 对扩展开放，对修改关闭 | 策略、装饰器、责任链 |
| **L** 里氏替换 | 子类必须能替代父类 | 所有继承体系 |
| **I** 接口隔离 | 接口要小而专 | 适配器、外观 |
| **D** 依赖倒置 | 依赖抽象，不依赖实现 | 工厂、依赖注入 |

还有两条经验法则同样重要：

- **组合优于继承**：继承是编译期绑定、强耦合；组合是运行期绑定、可替换。装饰器、策略、桥接都是这条法则的产物。
- **YAGNI**：不要为「将来可能会变」而抽象。等到第二次、第三次重复出现时再抽象，代价更低。

## 1.3 23 种模式全景

### 创建型（5）

| 模式 | 一句话意图 | 现代项目里的常见形态 |
| --- | --- | --- |
| 单例 Singleton | 保证全局唯一实例 | Spring Bean、连接池、配置中心 |
| 工厂方法 Factory Method | 子类决定创建哪个产品 | `BeanFactory`、`DriverManager` |
| 抽象工厂 Abstract Factory | 创建一整套相关产品 | 跨平台 UI 组件族 |
| 建造者 Builder | 分步构建复杂对象 | Lombok `@Builder`、`HttpRequest.builder()` |
| 原型 Prototype | 克隆现有对象 | 对象缓存、快照、`Object.clone()` |

### 结构型（7）

| 模式 | 一句话意图 | 现代项目里的常见形态 |
| --- | --- | --- |
| 适配器 Adapter | 转换接口，让不兼容的类协作 | SLF4J、`InputStreamReader` |
| 桥接 Bridge | 抽象与实现各自独立扩展 | JDBC、遥控器与设备 |
| 组合 Composite | 把对象组织成树，统一处理个体与整体 | 菜单、组织架构、表达式树 |
| 装饰器 Decorator | 动态叠加职责，不改变原类 | Java IO、Servlet Filter |
| 外观 Facade | 为子系统提供统一入口 | Service 门面、SDK 封装 |
| 享元 Flyweight | 共享内部状态，减少对象数量 | 线程池、`Integer` 缓存、对象池 |
| 代理 Proxy | 控制对对象的访问 | Spring AOP、RPC、懒加载 |

### 行为型（11）

| 模式 | 一句话意图 | 现代项目里的常见形态 |
| --- | --- | --- |
| 责任链 Chain of Responsibility | 请求沿链传递，直到有人处理 | Filter、Netty Pipeline、审批流 |
| 命令 Command | 把请求封装成对象 | `Runnable`、任务队列、撤销 |
| 解释器 Interpreter | 为语言定义文法并解释 | 正则、表达式引擎、DSL |
| 迭代器 Iterator | 顺序访问集合而不暴露内部结构 | `Iterator`、`for-each` |
| 中介者 Mediator | 用中介对象解耦多对多通信 | 聊天室、消息总线、MVC Controller |
| 备忘录 Memento | 保存与恢复对象状态 | 撤销、快照、事务回滚 |
| 观察者 Observer | 一对多依赖，状态变化自动通知 | Spring Event、`watch`、事件总线 |
| 状态 State | 状态决定行为，状态可切换 | 订单状态机、TCP 连接 |
| 策略 Strategy | 封装可互换的算法 | 支付方式、排序策略、限流算法 |
| 模板方法 Template Method | 父类定骨架，子类填步骤 | `JdbcTemplate`、`AbstractList` |
| 访问者 Visitor | 在不改元素类的前提下增加操作 | AST 处理、报表导出 |

# 二、创建型：把「怎么创建」藏起来

## 2.1 单例：最常用，也最容易写错

**意图**：保证一个类只有一个实例，并提供全局访问点。

适用场景：无状态的工具类、配置中心、连接池、日志器。**注意「无状态」或「必须共享」是前提**，单例不是「全局变量的优雅说法」。

### 五种写法

```java
// ① 饿汉式：类加载时创建，线程安全，但不能懒加载
public class EagerSingleton {
    private static final EagerSingleton INSTANCE = new EagerSingleton();
    private EagerSingleton() {}
    public static EagerSingleton getInstance() { return INSTANCE; }
}

// ② 懒汉式：延迟创建，但线程不安全，仅用于说明问题
public class LazySingleton {
    private static LazySingleton instance;
    private LazySingleton() {}
    public static LazySingleton getInstance() {
        if (instance == null) {
            instance = new LazySingleton();   // 并发下会创建多个实例
        }
        return instance;
    }
}

// ③ 双重检查锁（DCL）：必须 volatile
public class DclSingleton {
    private static volatile DclSingleton instance;
    private DclSingleton() {}
    public static DclSingleton getInstance() {
        if (instance == null) {                    // 第一次检查：避免每次都加锁
            synchronized (DclSingleton.class) {
                if (instance == null) {            // 第二次检查：防止重复创建
                    instance = new DclSingleton();
                }
            }
        }
        return instance;
    }
}

// ④ 静态内部类：懒加载 + 线程安全 + 无锁
public class HolderSingleton {
    private HolderSingleton() {}
    private static class Holder {
        private static final HolderSingleton INSTANCE = new HolderSingleton();
    }
    public static HolderSingleton getInstance() { return Holder.INSTANCE; }
}

// ⑤ 枚举：线程安全、防反射、防反序列化破坏（推荐）
public enum EnumSingleton {
    INSTANCE;
    public void doSomething() {}
}
```

### DCL 为什么必须加 volatile

`instance = new DclSingleton()` 不是原子操作，它分三步：

```text
1. 分配内存
2. 初始化对象（执行构造方法）
3. instance 指向内存地址
```

如果没有 `volatile`，JVM / CPU 可能把第 2 步和第 3 步**重排序**。线程 A 执行到第 3 步、第 2 步还没完成时，线程 B 在第一次检查看到 `instance != null`，直接返回一个**构造未完成的对象**。

`volatile` 禁止这种重排序，同时保证可见性。

### 单例的破坏与防护

| 破坏方式 | 是否可破坏普通单例 | 防护 |
| --- | --- | --- |
| 反射调用私有构造 | 是 | 构造器里判断实例是否存在并抛异常；枚举天然免疫 |
| 反序列化 | 是（会创建新对象） | 实现 `readResolve()` 返回 `INSTANCE`；枚举天然免疫 |
| 克隆 | 是 | 不实现 `Cloneable`，或重写 `clone()` 抛异常 |
| 多 ClassLoader | 是 | 每个 ClassLoader 各有一份静态变量 |

### 单例的代价

单例本质是**全局状态**，会带来三个问题：隐藏依赖（看方法签名不知道它用了单例）、难以测试（无法注入 mock）、并发下的状态共享风险。**现代项目更推荐用依赖注入容器管理「单例作用域」，而不是手写 `getInstance()`**——同样是单实例，但依赖是显式的。

## 2.2 工厂：三种工厂别混为一谈

| 形态 | 做什么 | 扩展新产品时 | 典型代码 |
| --- | --- | --- | --- |
| 简单工厂 | 一个方法根据参数返回不同产品 | 修改工厂的 `switch` | `PaymentFactory.create(type)` |
| 工厂方法 | 每个产品对应一个工厂子类 | 新增工厂类，不改旧代码 | `LoggerFactory`、`BeanFactory` |
| 抽象工厂 | 一个工厂创建**一族**相关产品 | 新增产品族，不改旧代码 | 跨平台 UI（Button + Checkbox） |

```java
// 简单工厂：集中创建，适合产品少、变化不频繁
public class PaymentFactory {
    public static Payment create(String type) {
        return switch (type) {
            case "alipay" -> new AlipayPayment();
            case "wechat" -> new WechatPayment();
            default -> throw new IllegalArgumentException("unknown: " + type);
        };
    }
}
```

简单工厂的 `switch` 违反了开闭原则，但它**足够简单**。产品只有三五种、一年改一次，用简单工厂比一堆工厂子类更划算。工厂方法把选择推迟到子类，代价是类数量膨胀。

```java
// 工厂方法：新增产品时只加类，不改已有代码
public interface PaymentFactory { Payment create(); }

public class AlipayFactory implements PaymentFactory {
    public Payment create() { return new AlipayPayment(); }
}
```

**怎么选**：产品维度单一、数量少 → 简单工厂；产品维度单一、需要频繁扩展 → 工厂方法；**多个产品维度需要成套创建** → 抽象工厂。

## 2.3 建造者：解决「参数太多」

当一个类有 10 个可选参数，构造器会变成灾难：重载爆炸、参数顺序靠猜、对象可能处于半成品状态。

```java
public class HttpRequest {
    private final String url;
    private final String method;
    private final Map<String, String> headers;
    private final Duration timeout;

    private HttpRequest(Builder b) {
        this.url = b.url;
        this.method = b.method;
        this.headers = Map.copyOf(b.headers);
        this.timeout = b.timeout;
    }

    public static class Builder {
        private final String url;                       // 必填
        private String method = "GET";                  // 选填有默认值
        private final Map<String, String> headers = new HashMap<>();
        private Duration timeout = Duration.ofSeconds(5);

        public Builder(String url) { this.url = Objects.requireNonNull(url); }
        public Builder method(String m) { this.method = m; return this; }
        public Builder header(String k, String v) { headers.put(k, v); return this; }
        public Builder timeout(Duration d) { this.timeout = d; return this; }
        public HttpRequest build() {
            // 在这里做整体校验，保证 build 出来的对象一定合法
            return new HttpRequest(this);
        }
    }
}
```

**建造者 vs 工厂**：工厂关注「创建哪个对象」，建造者关注「怎么一步步组装一个复杂对象」。工厂通常一步返回；建造者分多步，最后 `build()`。

**建造者的代价**：多写一个内部类。如果参数少、都必填，普通构造器更好；Lombok 的 `@Builder` 只是省了样板代码，不改变这个判断。

## 2.4 原型：克隆而不是 new

**意图**：用现有实例作为模板，复制出新对象，避免重复执行昂贵的初始化。

```java
public class Report implements Cloneable {
    private String title;
    private List<String> rows;

    @Override
    public Report clone() {
        try {
            Report copy = (Report) super.clone();       // 浅拷贝
            copy.rows = new ArrayList<>(this.rows);      // 手动深拷贝引用类型
            return copy;
        } catch (CloneNotSupportedException e) {
            throw new AssertionError(e);
        }
    }
}
```

**浅拷贝 vs 深拷贝**是原型模式的核心坑：`Object.clone()` 只复制字段值，引用类型仍然指向同一个对象。修改副本的 `List` 会影响原对象。深拷贝要手动处理每个引用字段，或用序列化 / JSON 往返（性能差，但简单）。

实际项目里，原型模式更多以「快照」「模板」「对象池」的形式出现，而不是直接实现 `Cloneable`。Java 的 `Cloneable` 设计本身也常被批评：它不包含 `clone()` 方法、返回值是 `Object`、受检异常设计别扭。

# 三、结构型：把对象组合成更大的结构

## 3.1 适配器：让不兼容的接口合作

**意图**：把一个类的接口转换成客户端期望的另一个接口。

```java
// 旧系统只认这个接口
public interface LegacyLogger { void writeLog(String msg); }

// 新代码统一用 SLF4J
public class Slf4jAdapter implements LegacyLogger {
    private final Logger delegate = LoggerFactory.getLogger(Slf4jAdapter.class);

    @Override
    public void writeLog(String msg) {
        delegate.info(msg);          // 接口转换，不是功能增强
    }
}
```

两种实现方式：

- **对象适配器**（组合）：持有被适配对象，推荐
- **类适配器**（继承）：同时继承被适配类和实现目标接口，Java 单继承限制大，少用

**适配器 vs 装饰器**：适配器**改变接口**，不改变功能；装饰器**保持接口**，增强功能。**适配器 vs 外观**：适配器包装一个类，让它符合某个接口；外观包装一组类，提供一个简化入口。

## 3.2 桥接：两个维度独立变化

**意图**：把抽象部分与实现部分分离，使它们可以各自独立扩展。

典型例子是 JDBC：`DriverManager` / `Connection` 是抽象侧，各数据库的 `Driver` 是实现侧。换数据库不需要改上层代码，加数据库只需加一个 Driver。

```java
// 实现维度：消息发送渠道
interface MessageSender { void send(String text); }
class SmsSender implements MessageSender { public void send(String t) { /* ... */ } }
class EmailSender implements MessageSender { public void send(String t) { /* ... */ } }

// 抽象维度：消息类型
abstract class Message {
    protected final MessageSender sender;
    protected Message(MessageSender sender) { this.sender = sender; }
    public abstract void send(String text);
}
class UrgentMessage extends Message {
    public UrgentMessage(MessageSender s) { super(s); }
    public void send(String text) { sender.send("[紧急] " + text); }
}
```

如果不用桥接，用继承实现「紧急短信」「紧急邮件」「普通短信」「普通邮件」，类数量是**乘法**；用桥接是**加法**。**当两个维度都会独立扩展时，用桥接；只有一个维度变化时，用策略或继承就够了。**

## 3.3 组合：个体与整体一视同仁

**意图**：把对象组织成树形结构，让客户端统一对待单个对象和组合对象。

```java
public interface Node {
    int size();
    void print(String indent);
}

public class FileNode implements Node {
    private final int bytes;
    public FileNode(int bytes) { this.bytes = bytes; }
    public int size() { return bytes; }
    public void print(String indent) { System.out.println(indent + "file"); }
}

public class DirNode implements Node {
    private final List<Node> children = new ArrayList<>();
    public void add(Node n) { children.add(n); }
    public int size() { return children.stream().mapToInt(Node::size).sum(); }
    public void print(String indent) {
        System.out.println(indent + "dir");
        children.forEach(c -> c.print(indent + "  "));
    }
}
```

文件系统、组织架构、菜单、表达式树都是组合模式。**关键判断**：客户端是否需要「不关心它是一片叶子还是一棵树」。

## 3.4 装饰器：动态叠加功能

**意图**：在不改变原类、不使用继承的情况下，给对象动态添加职责。

```java
InputStream in = new BufferedInputStream(
                    new GZIPInputStream(
                        new FileInputStream("data.gz")));
```

Java IO 是装饰器最经典的教科书案例：`FileInputStream` 提供基础字节流，`BufferedInputStream` 加缓冲，`GZIPInputStream` 加解压。每一层都实现 `InputStream`，可以任意嵌套。

```java
public interface Coffee { int cost(); String desc(); }

public class Espresso implements Coffee {
    public int cost() { return 20; }
    public String desc() { return "Espresso"; }
}

public abstract class CoffeeDecorator implements Coffee {
    protected final Coffee inner;
    protected CoffeeDecorator(Coffee inner) { this.inner = inner; }
}

public class Milk extends CoffeeDecorator {
    public Milk(Coffee inner) { super(inner); }
    public int cost() { return inner.cost() + 5; }
    public String desc() { return inner.desc() + " + Milk"; }
}
```

**装饰器 vs 继承**：继承是编译期静态叠加，类数量按组合爆炸；装饰器是运行期动态叠加，按需组合。代价是对象数量变多、调试时调用栈变深、装饰顺序有语义。

## 3.5 外观：给子系统一个统一入口

**意图**：为复杂子系统提供一组接口的简化入口，降低客户端与子系统的耦合。

```java
public class OrderFacade {
    private final InventoryService inventory;
    private final PaymentService payment;
    private final ShippingService shipping;

    public void placeOrder(Order order) {
        inventory.lock(order);
        payment.charge(order);
        shipping.schedule(order);
    }
}
```

外观不增加新功能，只做**编排与简化**。它和中介者的区别是：**外观是单向的**（客户端 → 外观 → 子系统，子系统不知道外观存在）；**中介者是双向的**（同事对象之间通过中介者互相通信，同事知道中介者）。

## 3.6 享元：共享不变的部分

**意图**：用共享技术有效支持大量细粒度对象。

关键是把对象状态拆成：

- **内部状态（intrinsic）**：可共享、不随环境变化
- **外部状态（extrinsic）**：不可共享、由客户端传入

```java
// 字符格式是内部状态，字符位置是外部状态
public record CharStyle(String font, int size, String color) {}

public class StyleFactory {
    private static final Map<String, CharStyle> CACHE = new HashMap<>();
    public static CharStyle of(String font, int size, String color) {
        String key = font + "|" + size + "|" + color;
        return CACHE.computeIfAbsent(key, k -> new CharStyle(font, size, color));
    }
}
```

JDK 里的 `Integer.valueOf(int)` 缓存 `-128..127`、`String` 常量池、线程池、连接池，本质上都是享元思想的不同变体。

**享元的代价**：共享对象必须不可变，否则一处修改会影响所有用户；缓存本身要管理生命周期，否则从「省内存」变成「泄漏内存」。

## 3.7 代理：控制访问

**意图**：为其他对象提供一种代理，以控制对这个对象的访问。

| 代理类型 | 实现方式 | 典型框架 |
| --- | --- | --- |
| 静态代理 | 手写实现同一接口，持有目标对象 | 简单包装 |
| JDK 动态代理 | `Proxy` + `InvocationHandler`，**目标必须实现接口** | Spring AOP（有接口时） |
| CGLIB 动态代理 | 生成子类字节码，**不能代理 final 类/方法** | Spring AOP（无接口时） |

代理能做的四类事：

1. **远程代理**：RPC 客户端看起来像本地调用
2. **虚拟代理**：懒加载大对象
3. **保护代理**：权限校验
4. **智能引用**：引用计数、缓存、日志、事务

```java
// JDK 动态代理：事务、日志、权限的通用切面
public class LogHandler implements InvocationHandler {
    private final Object target;
    public LogHandler(Object target) { this.target = target; }

    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        long start = System.nanoTime();
        try {
            return method.invoke(target, args);
        } finally {
            System.out.printf("%s took %d ns%n", method.getName(), System.nanoTime() - start);
        }
    }
}
```

**代理 vs 装饰器**：两者结构几乎一样（都持有目标、实现同一接口），但**意图不同**——代理控制访问，通常由框架创建，客户端往往不知道代理的存在；装饰器增强功能，由客户端主动组合，强调可叠加。

# 四、行为型：对象之间怎么协作

## 4.1 策略：把算法变成可替换的零件

**意图**：定义一系列算法，分别封装，使它们可以互相替换。

```java
public interface DiscountStrategy {
    BigDecimal apply(BigDecimal original);
}

public class FullReduction implements DiscountStrategy {
    public BigDecimal apply(BigDecimal original) {
        return original.compareTo(new BigDecimal("300")) >= 0
             ? original.subtract(new BigDecimal("50")) : original;
    }
}

public class Percentage implements DiscountStrategy {
    private final BigDecimal rate;
    public Percentage(BigDecimal rate) { this.rate = rate; }
    public BigDecimal apply(BigDecimal original) { return original.multiply(rate); }
}

// 上下文：持有策略，但不关心具体算法
public class PriceCalculator {
    private final DiscountStrategy strategy;
    public PriceCalculator(DiscountStrategy strategy) { this.strategy = strategy; }
    public BigDecimal calculate(BigDecimal price) { return strategy.apply(price); }
}
```

策略模式解决的问题是：**把 `if/else` / `switch` 里那些「同一种行为的不同实现」抽出来，让新增实现不再修改调用方。**

**但别急着消灭所有 `if/else`**。三五个分支、逻辑简单、未来不太会变，`switch` 比五个策略类更易读。策略模式的价值在「分支会持续增长」或「算法需要独立测试/复用」时才体现。

## 4.2 状态：状态决定行为

**意图**：允许对象在内部状态改变时改变它的行为，看起来像换了类。

```java
public interface OrderState {
    void pay(Order order);
    void ship(Order order);
    void cancel(Order order);
}

public class PendingState implements OrderState {
    public void pay(Order o) { o.setState(new PaidState()); }
    public void ship(Order o) { throw new IllegalStateException("未支付不能发货"); }
    public void cancel(Order o) { o.setState(new CancelledState()); }
}

public class PaidState implements OrderState {
    public void pay(Order o) { throw new IllegalStateException("已支付"); }
    public void ship(Order o) { o.setState(new ShippedState()); }
    public void cancel(Order o) { o.setState(new RefundingState()); }
}
```

**策略 vs 状态**：这是最高频的混淆点。

| 维度 | 策略 | 状态 |
| --- | --- | --- |
| 谁决定切换 | 客户端从外部选择 | 对象内部根据事件切换 |
| 状态之间是否知道彼此 | 通常不知道 | 知道，且负责转移 |
| 关注点 | 同一行为的不同算法 | 对象在不同状态下的行为差异 |
| 典型场景 | 支付方式、排序算法 | 订单状态机、TCP 连接 |

一句话：**策略是「你选一个算法」，状态是「对象自己走到下一步」**。

## 4.3 责任链：请求沿着链传递

**意图**：把请求的发送者和接收者解耦，让多个对象都有机会处理请求。

```java
public abstract class Approver {
    private Approver next;

    public Approver setNext(Approver next) {
        this.next = next;
        return next;                       // 支持链式组装
    }

    public final void approve(Request req) {
        if (canApprove(req)) {
            doApprove(req);
        } else if (next != null) {
            next.approve(req);             // 自己不处理，交给下一位
        } else {
            throw new IllegalStateException("无人能处理: " + req);
        }
    }

    protected abstract boolean canApprove(Request req);
    protected abstract void doApprove(Request req);
}
```

责任链的两种语义要分清：

- **纯责任链**：要么处理，要么传递，只有一个处理者（审批流）
- **不纯责任链**：每个节点都可以做一些事再传递（Filter、Netty Pipeline、中间件）

**实践注意**：链太长会影响性能；要有明确的终止条件，否则可能死循环；链的组装顺序有语义（鉴权必须在业务之前）。

## 4.4 观察者：一对多通知

**意图**：定义对象间的一对多依赖，当一个对象状态改变时，所有依赖它的对象都得到通知。

```java
public interface OrderListener {
    void onPaid(Order order);
}

public class OrderService {
    private final List<OrderListener> listeners = new CopyOnWriteArrayList<>();

    public void register(OrderListener l) { listeners.add(l); }

    public void pay(Order order) {
        order.markPaid();
        for (OrderListener l : listeners) {
            l.onPaid(order);              // 通知所有观察者
        }
    }
}
```

**观察者 vs 发布订阅**：

| 维度 | 观察者 | 发布订阅 |
| --- | --- | --- |
| 耦合 | 主题直接持有观察者列表 | 双方只依赖事件总线 / Broker |
| 通信 | 通常是同步调用 | 通常异步，可跨进程 |
| 生命周期 | 同进程 | 可持久化、可重放 |
| 典型实现 | Spring `ApplicationEvent`、`watch` | Kafka、RabbitMQ、Redis Pub/Sub |

一句话：**发布订阅是观察者的解耦升级版**——观察者模式里主题知道有哪些观察者，发布订阅里发布者根本不知道订阅者是谁。

**观察者的坑**：同步通知会阻塞主流程（一个监听器慢，全链路慢）；监听器异常可能影响其他监听器；通知顺序不确定；内存泄漏（注册了但忘记注销）。

## 4.5 模板方法：父类定骨架，子类填细节

**意图**：在一个方法中定义算法骨架，将某些步骤延迟到子类实现。

```java
public abstract class DataImporter {
    // 模板方法：final，防止子类改变流程
    public final void importData(String path) {
        validate(path);
        List<String> rows = read(path);
        List<Record> records = parse(rows);
        save(records);
        afterImport(records);              // 钩子方法，子类可选覆盖
    }

    protected abstract List<String> read(String path);
    protected abstract List<Record> parse(List<String> rows);
    protected abstract void save(List<Record> records);

    protected void validate(String path) { /* 默认实现 */ }
    protected void afterImport(List<Record> records) { /* 空钩子 */ }
}
```

这就是**好莱坞原则**：「别找我们，我们会找你」——父类控制流程，子类只提供被调用的步骤。

JDK 里 `AbstractList`、`AbstractMap`，Spring 的 `JdbcTemplate`、`AbstractApplicationContext` 都是模板方法。**模板方法的代价**：继承耦合，子类受父类流程约束；流程一变，所有子类受影响。能用组合（策略 + 编排）替代时，优先组合。

## 4.6 命令：把请求封装成对象

**意图**：把请求封装成对象，从而支持参数化、排队、记录日志、撤销。

```java
public interface Command {
    void execute();
    void undo();
}

public class AddStockCommand implements Command {
    private final Inventory inventory;
    private final int amount;

    public AddStockCommand(Inventory inventory, int amount) {
        this.inventory = inventory;
        this.amount = amount;
    }

    public void execute() { inventory.add(amount); }
    public void undo() { inventory.subtract(amount); }
}

public class CommandInvoker {
    private final Deque<Command> history = new ArrayDeque<>();

    public void run(Command c) { c.execute(); history.push(c); }
    public void undoLast() { if (!history.isEmpty()) history.pop().undo(); }
}
```

`Runnable` 就是一个没有撤销功能的命令；线程池的任务队列是命令模式的典型应用；数据库事务日志、编辑器的撤销栈也是。

## 4.7 迭代器：遍历而不暴露内部结构

**意图**：提供一种方法顺序访问聚合对象中的元素，而不暴露其内部表示。

```java
public class RingBuffer<T> implements Iterable<T> {
    private final Object[] items;
    private int start, size;

    @Override
    public Iterator<T> iterator() {
        return new Iterator<>() {
            private int cursor = 0;
            public boolean hasNext() { return cursor < size; }
            @SuppressWarnings("unchecked")
            public T next() { return (T) items[(start + cursor++) % items.length]; }
        };
    }
}
```

迭代器把「遍历逻辑」从「数据结构」中分离。**注意 fail-fast**：`ArrayList` 的迭代器在结构被修改时会抛 `ConcurrentModificationException`，这是通过 `modCount` 检查实现的；并发场景要用 `CopyOnWriteArrayList` 或显式同步。

## 4.8 中介者：把网状关系变成星形

**意图**：用一个中介对象封装一系列对象之间的交互，使它们松散耦合。

```java
public class ChatRoom {
    private final Map<String, User> users = new HashMap<>();

    public void join(User user) { users.put(user.getName(), user); }

    public void send(String from, String to, String msg) {
        User target = users.get(to);
        if (target != null) target.receive(from, msg);
    }
}
```

不用中介者时，N 个用户两两通信是 N² 条关系；用中介者后变成 N 条。代价是中介者可能变成「上帝对象」，承担过多逻辑。

**中介者 vs 外观**：外观简化**单向**调用；中介者协调**多向**通信，同事对象之间通过中介者交互。

## 4.9 备忘录：保存与恢复状态

**意图**：在不破坏封装的前提下，捕获并保存对象的内部状态，以便之后恢复。

```java
public class Editor {
    private String text;

    public Memento save() { return new Memento(text); }
    public void restore(Memento m) { this.text = m.text(); }

    // 备忘录：对外不可变，只有 Editor 能读取
    public record Memento(String text) {}
}
```

关键是**封装**：备忘录只暴露给原发器（Editor），不暴露给管理者（History）。实际应用：撤销/重做、事务回滚、游戏存档、数据库 savepoint。**代价**：快照占内存，频繁快照要考虑增量或持久化。

## 4.10 访问者：数据结构稳定，操作多变

**意图**：在不改变元素类的前提下，定义作用于这些元素的新操作。

```java
public interface Shape {
    <R> R accept(ShapeVisitor<R> visitor);
}
public record Circle(double r) implements Shape {
    public <R> R accept(ShapeVisitor<R> v) { return v.visit(this); }
}
public record Square(double side) implements Shape {
    public <R> R accept(ShapeVisitor<R> v) { return v.visit(this); }
}

public interface ShapeVisitor<R> {
    R visit(Circle c);
    R visit(Square s);
}

// 新增操作：加一个 Visitor 实现，不改 Shape 体系
public class AreaVisitor implements ShapeVisitor<Double> {
    public Double visit(Circle c) { return Math.PI * c.r() * c.r(); }
    public Double visit(Square s) { return s.side() * s.side(); }
}
```

访问者的核心是**双重分派**：第一次由元素的 `accept` 分派到具体元素类型，第二次由元素调用 `visitor.visit(this)` 分派到具体操作。

**什么时候用**：数据结构（元素类型）稳定，但操作经常增加——编译器 AST、报表导出、序列化。**什么时候不用**：元素类型经常增加，因为每加一个元素，所有 Visitor 都要改，开闭原则反而被破坏。

## 4.11 解释器：为小型语言定义文法

**意图**：给定一个语言，定义它的文法表示，并定义一个解释器来解释句子。

```java
public interface Expr { int interpret(Map<String, Integer> ctx); }

public record Num(int value) implements Expr {
    public int interpret(Map<String, Integer> ctx) { return value; }
}
public record Var(String name) implements Expr {
    public int interpret(Map<String, Integer> ctx) { return ctx.getOrDefault(name, 0); }
}
public record Add(Expr left, Expr right) implements Expr {
    public int interpret(Map<String, Integer> ctx) {
        return left.interpret(ctx) + right.interpret(ctx);
    }
}
```

适用场景：SQL 解析、正则表达式、规则引擎、简单 DSL。**但真正的语言解析几乎不会手写解释器模式**，而是用 ANTLR、JavaCC 等工具生成 AST。解释器模式适合「文法非常简单、变化不频繁」的场景，复杂文法下类数量会爆炸。

# 五、最容易混淆的十组模式

![四组易混模式对比：策略由客户端选择算法，状态由对象内部切换；代理控制访问，装饰器叠加功能](/images/blog/design-patterns/pattern-compare.svg)

| 对比 | 核心区别 | 一句话记忆 |
| --- | --- | --- |
| 策略 vs 状态 | 策略由外部选择；状态由内部切换 | 策略是「选算法」，状态是「走流程」 |
| 代理 vs 装饰器 | 代理控制访问；装饰器增强功能 | 代理是「替身」，装饰器是「加料」 |
| 适配器 vs 外观 | 适配器转换一个接口；外观简化一组接口 | 适配器「翻译」，外观「前台」 |
| 适配器 vs 装饰器 | 适配器改接口；装饰器保接口 | 适配器让你「能用」，装饰器让你「更强」 |
| 工厂方法 vs 抽象工厂 | 一个产品 vs 一族产品 | 工厂方法造「一个」，抽象工厂造「一套」 |
| 建造者 vs 工厂 | 分步组装 vs 一步创建 | 建造者管「过程」，工厂管「选择」 |
| 观察者 vs 发布订阅 | 直接持有 vs 通过 Broker | 观察者「认识你」，发布订阅「不认识」 |
| 责任链 vs 装饰器 | 链上只有一个处理（或不纯链）；装饰器层层增强 | 责任链「传递」，装饰器「包裹」 |
| 组合 vs 继承 | 树形整体-部分 vs 父子类型 | 组合「has-a 树」，继承「is-a 链」 |
| 中介者 vs 外观 | 多向协调 vs 单向简化 | 中介者「交换机」，外观「总服务台」 |

# 六、框架里的设计模式

## 6.1 Spring

| 模式 | 在 Spring 中的体现 |
| --- | --- |
| 单例 | Bean 默认 `singleton` 作用域 |
| 工厂 | `BeanFactory`、`FactoryBean` |
| 模板方法 | `JdbcTemplate`、`RestTemplate`、`AbstractApplicationContext.refresh()` |
| 代理 | AOP、`@Transactional`、`@Async` |
| 观察者 | `ApplicationEventPublisher` / `@EventListener` |
| 责任链 | `HandlerInterceptor`、`FilterChain`、`SecurityFilterChain` |
| 策略 | `PlatformTransactionManager`、`HandlerMapping`、`HttpMessageConverter` |
| 适配器 | `HandlerAdapter`、`MessageConverter` |
| 外观 | `JdbcTemplate` 封装 JDBC 的样板代码 |

## 6.2 JDK

| 模式 | 体现 |
| --- | --- |
| 装饰器 | `java.io` 的 `InputStream` / `OutputStream` 体系 |
| 迭代器 | `Collection.iterator()`、`for-each` |
| 观察者 | `java.util.Observer`（已废弃）、`Flow` API（JDK 9+） |
| 命令 | `Runnable`、`Callable` |
| 策略 | `Comparator`、`ThreadPoolExecutor` 的拒绝策略 |
| 模板方法 | `AbstractList`、`AbstractMap`、`InputStream.read()` |
| 享元 | `Integer.valueOf()` 缓存、`String` 常量池 |
| 适配器 | `InputStreamReader`（字节流 → 字符流）、`Arrays.asList()` |
| 代理 | `java.lang.reflect.Proxy` |
| 建造者 | `StringBuilder`、`HttpRequest.newBuilder()` |

## 6.3 前端

- **观察者 / 发布订阅**：Vue 的响应式依赖收集、Redux 的 `subscribe`、浏览器 `addEventListener`
- **策略**：表单校验器、不同环境的 API 实现
- **装饰器**：React 高阶组件（HOC）、TypeScript 装饰器、`connect()`
- **组合**：React 组件树本身就是组合结构
- **模板方法**：React 生命周期 / Hooks 的固定调用顺序
- **状态**：有限状态机（XState）

**注意**：React Hooks 之后，很多「模式」被更简单的组合取代了。HOC 嵌套地狱 → 自定义 Hook；继承 → 组合。这恰好印证了那条原则：**模式是手段，不是目的**。

# 七、面试怎么答

## 7.1 高频问题

**Q1：单例有几种写法？DCL 为什么需要 volatile？**

饿汉、懒汉、DCL、静态内部类、枚举。DCL 的 `instance = new` 包含分配内存、初始化、赋值三步，可能重排序；没有 `volatile` 时，另一个线程可能看到非空但未初始化完成的对象。`volatile` 禁止重排序并保证可见性。

**Q2：单例有什么缺点？**

全局状态导致依赖隐藏、难测试、并发共享风险；多 ClassLoader 下不唯一；反射/反序列化可破坏（枚举除外）。现代项目更推荐容器管理的单例作用域 + 依赖注入。

**Q3：策略模式和状态模式的区别？**

策略由客户端从外部选择算法，策略之间互不知道；状态由对象内部根据事件切换，状态知道下一步转移到哪里。策略关注「同一行为的不同实现」，状态关注「不同状态下的行为差异」。

**Q4：代理模式和装饰器模式的区别？**

结构相似（都实现同一接口、持有目标），意图不同：代理控制访问（远程、懒加载、权限、事务），通常由框架创建；装饰器增强功能，由客户端主动组合，可多层嵌套。

**Q5：适配器和外观的区别？**

适配器转换**一个**类的接口，让不兼容的双方能协作；外观为**一组**子系统提供简化入口，不改变任何接口。

**Q6：工厂方法 vs 抽象工厂？**

工厂方法一个工厂创建一个产品，新增产品加工厂子类；抽象工厂一个工厂创建一族相关产品，新增产品族加工厂实现，但新增产品类型要改所有工厂。

**Q7：观察者和发布订阅的区别？**

观察者中主题直接持有观察者列表，强耦合、通常同步；发布订阅通过事件总线/Broker 解耦，发布者不知道订阅者，通常异步、可跨进程、可持久化。

**Q8：责任链怎么终止？会不会死循环？**

纯责任链在处理后停止，或不处理就传给下一个，链尾抛异常或返回默认值；不纯责任链每层都执行。死循环要靠「链不能成环」的约束和链长度上限来防。

**Q9：Spring 用了哪些设计模式？**

单例（Bean 作用域）、工厂（BeanFactory）、模板方法（JdbcTemplate）、代理（AOP）、观察者（ApplicationEvent）、责任链（Filter/Interceptor）、策略（HandlerMapping、事务管理器）、适配器（HandlerAdapter）。

**Q10：你项目里用过哪些设计模式？**

不要背模式名，讲**问题 → 方案 → 效果**。例如：「支付渠道有 8 种，原来是一个 300 行的 `switch`，每加渠道都要改主流程且容易漏。我们抽了 `PaymentStrategy` 接口 + 工厂按渠道取实现，新增渠道只加一个类，主流程零修改，单测也从集成测试降为策略单测。」

**Q11：设计模式是不是过度设计？怎么避免？**

是常见风险。判断标准：变化是否真实发生、是否重复出现、抽象是否降低了理解成本。遵守 YAGNI：第一次直接写，第二次复制时识别共性，第三次再抽象。模式应该从代码里「长出来」，而不是先画好模式图再填代码。

**Q12：开闭原则怎么落地？**

找到变化点并抽象它：策略隔离算法、工厂隔离创建、装饰器隔离附加功能、观察者隔离后续反应。但开闭不是「永远不改代码」——它要求**新增功能时尽量不改动已验证的核心流程**，而不是禁止一切修改。

**Q13：为什么组合优于继承？**

继承是编译期绑定、父类实现暴露给子类（打破封装）、单继承限制、父类变化影响所有子类；组合是运行期绑定、只依赖接口、可动态替换。继承适合「is-a 且行为稳定」，组合适合「has-a 且需要变化」。

**Q14：模板方法和策略怎么选？**

模板方法用继承固定流程、子类填步骤，适合流程稳定、步骤有复用；策略用组合替换整个算法，适合算法独立变化、需要运行期切换。**流程固定用模板方法，算法可变用策略**，两者也常一起用（模板方法内部持有策略）。

**Q15：手写一个线程安全的单例 / 策略 / 责任链。**

见上文代码。面试时优先写**静态内部类或枚举单例**（简洁且正确），DCL 要记得 `volatile`。策略要写清接口、实现、上下文/工厂。责任链要写清 `next`、终止条件、链式组装。

## 7.2 回答框架

被问到「用过什么设计模式」时，用这个结构：

```text
背景：某个业务/模块遇到了什么问题（if-else 膨胀、创建逻辑复杂、通知耦合）
约束：为什么不能简单改（改动面大、需要独立扩展、多个团队维护）
方案：用了哪个模式，抽象出了什么接口，谁负责创建/组合
效果：可量化最好（新增渠道从改 5 处变成加 1 个类、单测覆盖、上线零故障）
反思：代价是什么（类变多、调用链变深），后来怎么权衡
```

这比背 23 个定义有说服力得多。

# 八、速查表

## 8.1 按「变化点」选模式

| 你想隔离的变化 | 用哪个模式 |
| --- | --- |
| 对象的创建过程 / 创建哪个类 | 工厂方法、抽象工厂、建造者 |
| 算法的不同实现 | 策略 |
| 对象的内部状态与转移 | 状态 |
| 可叠加的附加功能 | 装饰器 |
| 对对象的访问控制 | 代理 |
| 不兼容的接口 | 适配器 |
| 复杂子系统的入口 | 外观 |
| 一对多的事件通知 | 观察者 / 发布订阅 |
| 请求的多个可能处理者 | 责任链 |
| 请求的排队、撤销、记录 | 命令 |
| 两个维度的独立扩展 | 桥接 |
| 树形的整体-部分结构 | 组合 |
| 大量细粒度对象的共享 | 享元 |
| 稳定数据结构上的多变操作 | 访问者 |
| 流程固定、步骤可变 | 模板方法 |

## 8.2 上手前的四问

```text
□ 这里真的有一个会变化、且已经重复出现的变化点吗？
□ 不用模式，最朴素的写法是什么？它具体痛在哪里？
□ 抽象之后，新增一种实现的成本降了吗？理解成本升了多少？
□ 这个模式是我主动选的，还是因为「面试要考」？
```

## 8.3 一句话总结

设计模式不是「让代码看起来高级」的装饰，而是**对反复出现的变化的命名**。真正会用模式的人，代码里往往看不到模式的痕迹——只有一个清晰的接口、一个合理的边界，以及一句「这里以后要加东西，所以抽了一下」。

下一篇《如何实现一套秒杀系统》会把这些模式放进一个真实的高并发场景：策略做限流、责任链做风控、状态机管订单、观察者做异步通知——但真正决定系统生死的，不是模式，而是**对流量、库存和一致性的理解**。
