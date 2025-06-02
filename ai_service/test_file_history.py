#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import requests
import json

def test_file_history_analysis():
    """测试文件历史分析功能"""
    
    # 构建测试数据
    test_prompt = """
请分析以下文件的历史演进情况：

文件路径: src/main.ts
总提交次数: 15
总新增行数: 450
总删除行数: 120
主要贡献者: Alice (8次提交), Bob (4次提交), Charlie (3次提交)

最近的提交历史：

1. [2024-01-15] Alice
   提交: 添加新的用户界面组件和交互逻辑
   变更: 修改 (+45/-12)

2. [2024-01-12] Bob
   提交: 修复性能问题，优化渲染流程
   变更: 修改 (+23/-8)

3. [2024-01-10] Alice
   提交: 重构数据处理模块，提升代码可维护性
   变更: 修改 (+67/-25)

4. [2024-01-08] Charlie
   提交: 添加错误处理和日志记录功能
   变更: 修改 (+34/-5)

5. [2024-01-05] Alice
   提交: 初始化项目结构和核心功能
   变更: 新增 (+180/-0)
"""

    # 测试数据
    test_data = {
        "file_path": "src/main.ts",
        "file_diff": test_prompt
    }
    
    try:
        # 发送请求
        response = requests.post(
            "http://127.0.0.1:5111/analyze_file_history",
            json=test_data,
            headers={"Content-Type": "application/json"},
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            analysis = result.get('analysis', {})
            summary = analysis.get('summary', '')
            
            print("✅ 文件历史分析测试成功!")
            print(f"📊 分析结果长度: {len(summary)} 字符")
            print(f"📝 分析内容预览: {summary[:200]}...")
            
            # 检查是否包含关键信息
            if any(keyword in summary for keyword in ['演进', '发展', '趋势', '建议']):
                print("✅ 分析内容包含预期的关键词")
            else:
                print("⚠️  分析内容可能缺少关键信息")
                
        else:
            print(f"❌ 请求失败，状态码: {response.status_code}")
            print(f"错误响应: {response.text}")
            
    except requests.exceptions.ConnectionError:
        print("❌ 无法连接到AI服务，请确保服务正在运行在端口5111")
    except requests.exceptions.Timeout:
        print("❌ 请求超时，AI服务可能响应缓慢")
    except Exception as e:
        print(f"❌ 测试失败: {e}")

def test_health_check():
    """测试健康检查端点"""
    try:
        response = requests.get("http://127.0.0.1:5111/health", timeout=5)
        if response.status_code == 200:
            health_data = response.json()
            print(f"✅ 健康检查通过: {health_data}")
        else:
            print(f"⚠️  健康检查异常: {response.status_code}")
    except Exception as e:
        print(f"❌ 健康检查失败: {e}")

if __name__ == "__main__":
    print("🔍 开始测试AI文件历史分析功能...")
    print("\n1. 测试健康检查...")
    test_health_check()
    
    print("\n2. 测试文件历史分析...")
    test_file_history_analysis()
    
    print("\n🎉 测试完成!") 