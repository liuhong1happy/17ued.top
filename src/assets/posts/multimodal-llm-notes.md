# 模型知识点

1. Seq2Seq

2. 注意力机制

3. Transformer

4. ViT

5. 激活函数 ReLU

6. GPT\-1 先使用未标注数据进行训练，再用标注数据进行微调（书读百遍其义自见）

7. GPT\-2 语言模型是无监督的多任务学习器

8. GPT\-3 语言模型是小样本学习器

9. GPT\-3\.5 代码训练、指令微调、基于人类反馈的强化学习、基于AI反馈的强化学习

10. GPT\-4 拥有对图像和文本的深度理解能力、基于规则的奖励模型

11. 未来模型畅想  自我学习与自我核实、稀疏专家模型

12. 两大类模型：判别式模型和生成式模型

13. GAN 生成对抗网络、判别器和生成器 

14. CLIP 文本和图像的桥梁，利用自然语言监督学习可迁移的视觉模型

15. Stable Diffusion 稳定扩散模型 = Clip Text Encoder \+ 图像信息创建器 U\-Net \+ 图像解码器 VAE、噪声图片

16. Stable Diffusion 2\.0  升级了ClipText模型

17. Stable Diffusion XL  双文本编码器、U‑Net、VAE\+Refiner

# 预训练模型

18. 预训练模型 方法一：TPU\+XLA\+TensorFlow、GPU\+Pytorch\+Megatron\-LM\+DeepSpeed

19. 思维链

20. 模型即服务 ModelScope\(魔塔\) Hugging Face

21. Transformers 顶尖机器学习工具库

22. Datasets 音频、计算机视觉和自然语言处理数据库访问库

23. Hugging Face Hub 机器学习模型、数据集和应用示例

24. Diffusers 生成图像、音频

25. Accelerate 分布式训练和推理

26. PERT 传统微调范式

# 应用落地

27. 外部增强：MRKL、Toolformer

28. 提示词工程

29. 模型微调 GLM系列模型

30. LangChain 模型胶水，对外提供服务 LLMChain、

31. Vsearch 分布式向量搜索系统

32. NL2SQL

33. DocTree

34. LoRA 参数高效微调技术

35. ControlNet

36. Civitai

37. CTranslate2 Whisper

38. FastAPI Sambert\-Hifigan

39. Midjourney

40. Celery 分布式任务队列工具



# 补充

## 预训练模型

BERT、GPT、LLaMA

## 微调方法

1. 监督微调法：这种方法是最常用的微调方法。它使用有标签的数据对模型进行训练，通过最小化模型预测结果与真实标签之间的差异，来优化模型参数。监督微调法的关键在于找到适当的的数据集，以确保模型能够学习到目标任务的特征。

2. 无监督微调法：这种方法适用于没有标签的数据集的情况。它利用无监督学习算法，如自编码器或生成对抗[网络](https://cloud.baidu.com/product/et.html)，来优化模型参数。无监督微调法的优点是可以避免标记数据的成本，但性能通常不如监督微调法。

3. 强化学习微调法：这种方法使用强化学习算法来训练模型。它通过[智能体](https://qianfan.cloud.baidu.com/appbuilder/)与环境交互，不断优化智能体的决策策略，使智能体能够更好地适应目标任务。强化学习微调法的优点是可以在没有标签数据的情况下进行训练，但训练过程需要更多的计算资源。

4. 元微调法：这种方法是一种层次式微调方法，它将多个微调任务组合在一起，形成一个元微调任务。通过元微调任务，模型可以学习到多个微调任务的共同特征，从而提高模型的泛化能力。元微调法的关键在于找到合适的微调任务组合，以获得最佳的性能。

## 应用落地

1. 外部增强

2. 提示词工程

3. 模型微调

4. 对外提供服务 LangChain

