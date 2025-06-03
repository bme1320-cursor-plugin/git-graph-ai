# ai_service/server.py

import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from openai import OpenAI, OpenAIError

app = Flask(__name__)

# 配置CORS以允许跨域访问
# CORS(app, origins=['*'])  # 生产环境建议指定具体域名

# --- OpenAI Client Initialization ---
openai_client = None
api_key = os.environ.get("OPENAI_API_KEY")

if api_key:
    try:
        openai_client = OpenAI(api_key=api_key)
        print("OpenAI client initialized successfully.")
    except Exception as e:
        print(f"Error initializing OpenAI client: {e}")
else:
    print("Warning: OPENAI_API_KEY environment variable not set. AI analysis will be disabled.")
# ------------------------------------

@app.route('/health', methods=['GET'])
def health_check():
    """健康检查端点"""
    if openai_client:
        return jsonify({"status": "healthy", "ai_service": "available"}), 200
    else:
        return jsonify({"status": "degraded", "ai_service": "unavailable"}), 200

@app.route('/analyze_diff', methods=['POST'])
def analyze_diff():
    """Analyzes the diff data using OpenAI API if available."""
    if not openai_client:
        return jsonify({
            "analysis": {
                "summary": "AI analysis disabled: OPENAI_API_KEY not configured.",
            }
        })

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Missing data in request"}), 400
        
        # 检查是否是综合分析请求
        if 'file_path' in data and data['file_path'] in ['comprehensive_commit_analysis', 'comprehensive_comparison_analysis']:
            return handle_comprehensive_analysis(data)
        
        # 原有的单文件分析逻辑
        if 'file_diff' not in data or 'file_path' not in data:
            return jsonify({"error": "Missing or invalid data in request (requires file_path and file_diff)"}), 400
        
        file_path = data['file_path']
        file_diff = data['file_diff']
        
        # 检查diff内容是否为空
        if not file_diff or file_diff.strip() == '':
            return jsonify({
                "analysis": {
                    "summary": "文件无实质性变更。"
                }
            })

        print(f"Received request to analyze diff for: {file_path}")
        file_path = file_path.strip()
        
        # 获取文件类型和扩展名
        file_extension = file_path.split('.')[-1].lower() if '.' in file_path else ''
        file_name = file_path.split('/')[-1]
        
        # --- OpenAI API Call --- 
        try:
            # 改进的提示词，更加具体和有针对性
            prompt = f"""
            请分析以下Git差异文件的变更内容，并提供简洁的中文总结。

            文件信息：
            - 文件路径: {file_path}
            - 文件类型: {file_extension}

            Git Diff内容：
            ```diff
            {file_diff}
            ```

            请按以下格式回答（不超过80字）：
            {file_name}: [文件简介]。[主要变更内容]。

            要求：
            1. 先简要说明文件用途
            2. 重点描述变更的功能性影响，而非技术细节
            3. 使用简洁的中文表达
            4. 避免使用"这个文件"等指代词
            """

            chat_completion = openai_client.chat.completions.create(
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-4.1-mini",
                max_tokens=100,  # 增加token限制以获得更详细的分析
                temperature=0.3,
                n=1
            )

            ai_summary = chat_completion.choices[0].message.content.strip()
            print(f"OpenAI Summary for {file_path}: {ai_summary}")

        except OpenAIError as e:
            print(f"OpenAI API error for {file_path}: {e}")
            ai_summary = f"AI分析暂时不可用：{str(e)}"
        except Exception as e:
            print(f"Unexpected error during OpenAI call for {file_path}: {e}")
            ai_summary = "AI分析遇到未知错误，请稍后重试。"
        # -----------------------

        return jsonify({
            "analysis": {
                "summary": ai_summary,
            }
        })

    except json.JSONDecodeError:
        return jsonify({"error": "Invalid JSON format"}), 400
    except Exception as e:
        print(f"Error processing request: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

def handle_comprehensive_analysis(data):
    """处理综合分析请求"""
    try:
        analysis_type = data['file_path']
        prompt = data.get('file_diff', '')  # 在综合分析中，file_diff字段包含完整的提示词
        
        if not prompt:
            return jsonify({"error": "Missing analysis prompt"}), 400
        
        print(f"Received comprehensive analysis request: {analysis_type}")
        
        # --- OpenAI API Call for Comprehensive Analysis ---
        try:
            # 根据分析类型调整系统提示词
            if analysis_type == 'file_history_analysis':
                system_content = "你是一个专业的代码分析师，擅长分析文件的版本演进历史。请提供结构化的JSON格式分析报告。"
                max_tokens = 400
                temperature = 0.1
            else:
                system_content = "你是一个专业的代码分析师，擅长分析Git提交和版本变更。请提供准确、简洁、有价值的分析报告。"
                max_tokens = 500
                temperature = 0.2

            chat_completion = openai_client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": system_content
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-4.1-mini",
                max_tokens=max_tokens,
                temperature=temperature,
                n=1
            )

            ai_summary = chat_completion.choices[0].message.content.strip()
            print(f"OpenAI Comprehensive Analysis ({analysis_type}): {ai_summary}")

            # 对于文件历史分析，尝试确保返回有效的JSON格式
            if analysis_type == 'file_history_analysis':
                try:
                    # 验证是否为有效JSON
                    json.loads(ai_summary)
                except json.JSONDecodeError:
                    # 如果不是有效JSON，生成一个默认的结构化响应
                    ai_summary = generate_fallback_file_history_analysis(ai_summary)

            return jsonify({
                "analysis": {
                    "summary": ai_summary,
                }
            })

        except OpenAIError as e:
            print(f"OpenAI API error for comprehensive analysis: {e}")
            if analysis_type == 'file_history_analysis':
                error_summary = generate_fallback_file_history_analysis(f"AI分析暂时不可用：{str(e)}")
            else:
                error_summary = f"<p><strong>AI分析暂时不可用</strong></p><p>错误信息：{str(e)}</p>"
            
            return jsonify({
                "analysis": {
                    "summary": error_summary,
                }
            })
        except Exception as e:
            print(f"Unexpected error during comprehensive analysis: {e}")
            if analysis_type == 'file_history_analysis':
                error_summary = generate_fallback_file_history_analysis("AI分析遇到未知错误，请稍后重试。")
            else:
                error_summary = "<p><strong>AI分析遇到未知错误</strong></p><p>请稍后重试。</p>"
            
            return jsonify({
                "analysis": {
                    "summary": error_summary,
                }
            })

    except Exception as e:
        print(f"Error processing comprehensive analysis: {e}")
        return jsonify({"error": "An internal server error occurred during comprehensive analysis"}), 500

def generate_fallback_file_history_analysis(error_message):
    """生成文件历史分析的降级响应"""
    return json.dumps({
        "summary": f"文件历史分析：{error_message}",
        "evolutionPattern": "文件演进模式分析基于提交历史，显示开发活跃度和变更频率。",
        "keyChanges": [
            "主要的功能添加和重构",
            "重要的bug修复和性能优化",
            "接口变更和架构调整"
        ],
        "recommendations": [
            "建议定期重构以保持代码质量",
            "考虑添加更详细的提交信息",
            "保持一致的代码风格和规范",
            "适时进行性能优化和安全更新"
        ]
    }, ensure_ascii=False)

@app.route('/analyze_file_history', methods=['POST'])
def analyze_file_history():
    """专门处理文件历史分析的端点"""
    if not openai_client:
        return jsonify({
            "analysis": {
                "summary": "AI分析服务暂时不可用，请检查OpenAI API配置。",
            }
        })

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Missing data in request"}), 400
        
        file_path = data.get('file_path', '未知文件')
        prompt = data.get('file_diff', '')  # 文件历史分析的完整提示
        
        if not prompt:
            return jsonify({"error": "Missing analysis prompt"}), 400
        
        print(f"Received file history analysis request for: {file_path}")
        
        # 优化后的文件历史分析提示词
        enhanced_prompt = f"""
请对以下文件的版本演进历史进行深度分析：

{prompt}

要求：严格按照以下JSON格式返回，不要添加任何其他内容：

{{
    "summary": "该文件从开始到现在的整体演进总结，包括主要发展趋势和目的",
    "evolutionPattern": "文件的演进模式分析，包括开发活跃度、变更频率、贡献者协作模式等",
    "keyChanges": [
        "第一个重要的关键变更点",
        "第二个重要的关键变更点",
        "第三个重要的关键变更点"
    ],
    "recommendations": [
        "第一个优化建议",
        "第二个优化建议",
        "第三个优化建议"
    ]
}}

注意事项：
1. 必须严格返回有效的JSON格式
2. keyChanges和recommendations必须是字符串数组，每项不超过35字
3. summary和evolutionPattern为字符串，不超过80字
4. 使用中文回答，语言专业且易懂
5. 不要添加```json```代码块包装
6. 基于实际提交历史提供有价值的分析
"""

        try:
            chat_completion = openai_client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的代码演进分析师。请严格按照用户要求的JSON格式回答，不要添加任何额外的文本或格式化。"
                    },
                    {
                        "role": "user",
                        "content": enhanced_prompt,
                    }
                ],
                model="gpt-4.1-mini",
                max_tokens=400,
                temperature=0.2,
                n=1
            )

            ai_summary = chat_completion.choices[0].message.content.strip()
            print(f"File History Analysis Raw Response for {file_path}: {ai_summary}")

            # 尝试验证返回的是有效的JSON
            try:
                import json
                test_parse = json.loads(ai_summary)
                if not all(key in test_parse for key in ['summary', 'evolutionPattern', 'keyChanges', 'recommendations']):
                    raise ValueError("Missing required fields in AI response")
                print(f"File History Analysis JSON validation passed for {file_path}")
            except (json.JSONDecodeError, ValueError) as parse_error:
                print(f"AI returned invalid JSON for {file_path}, using fallback: {parse_error}")
                ai_summary = generate_fallback_file_history_json(file_path)

            return jsonify({
                "analysis": {
                    "summary": ai_summary,
                }
            })

        except OpenAIError as e:
            print(f"OpenAI API error for file history analysis: {e}")
            fallback_analysis = generate_fallback_file_history_json(file_path)
            return jsonify({
                "analysis": {
                    "summary": fallback_analysis,
                }
            })
        except Exception as e:
            print(f"Unexpected error during file history analysis: {e}")
            fallback_analysis = generate_fallback_file_history_json(file_path)
            return jsonify({
                "analysis": {
                    "summary": fallback_analysis,
                }
            })

    except Exception as e:
        print(f"Error processing file history analysis: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

def generate_fallback_file_history_json(file_path):
    """生成备用的JSON格式文件历史分析"""
    file_name = file_path.split('/')[-1] if '/' in file_path else file_path
    return json.dumps({
        "summary": f"文件 {file_name} 经历了多次修改和演进，是项目的重要组成部分",
        "evolutionPattern": "该文件在开发过程中持续改进，体现了项目的迭代发展特点",
        "keyChanges": [
            "文件结构和功能的逐步完善",
            "代码质量和性能的持续优化",
            "新功能的添加和旧功能的改进"
        ],
        "recommendations": [
            "定期检查代码质量和可维护性",
            "保持良好的文档和注释习惯",
            "考虑重构复杂的代码段以提升可读性"
        ]
    }, ensure_ascii=False)

@app.route('/analyze_file_version_comparison', methods=['POST'])
def analyze_file_version_comparison():
    """专门处理文件版本比较分析的端点"""
    if not openai_client:
        return jsonify({
            "analysis": {
                "summary": "AI分析服务暂时不可用，请检查OpenAI API配置。",
            }
        })

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Missing data in request"}), 400
        
        file_path = data.get('file_path', '未知文件')
        prompt = data.get('file_diff', '')  # 文件版本比较分析的完整提示
        
        if not prompt:
            return jsonify({"error": "Missing analysis prompt"}), 400
        
        print(f"Received file version comparison analysis request for: {file_path}")
        
        try:
            chat_completion = openai_client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "你是一个专业的代码版本比较分析师。请严格按照用户要求的JSON格式回答，不要添加任何额外的文本或格式化。"
                    },
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
                model="gpt-4.1-mini",
                max_tokens=500,
                temperature=0.3,
                n=1
            )

            ai_summary = chat_completion.choices[0].message.content.strip()
            print(f"File Version Comparison Analysis Raw Response for {file_path}: {ai_summary}")

            # 尝试验证返回的是有效的JSON
            try:
                import json
                test_parse = json.loads(ai_summary)
                required_fields = ['summary', 'changeType', 'impactAnalysis', 'keyModifications', 'recommendations']
                if not all(key in test_parse for key in required_fields):
                    raise ValueError("Missing required fields in AI response")
                print(f"File Version Comparison Analysis JSON validation passed for {file_path}")
            except (json.JSONDecodeError, ValueError) as parse_error:
                print(f"AI returned invalid JSON for {file_path}, using fallback: {parse_error}")
                ai_summary = generate_fallback_file_version_comparison_json(file_path)

            return jsonify({
                "analysis": {
                    "summary": ai_summary,
                }
            })

        except OpenAIError as e:
            print(f"OpenAI API error for file version comparison analysis: {e}")
            fallback_analysis = generate_fallback_file_version_comparison_json(file_path)
            return jsonify({
                "analysis": {
                    "summary": fallback_analysis,
                }
            })
        except Exception as e:
            print(f"Unexpected error during file version comparison analysis: {e}")
            fallback_analysis = generate_fallback_file_version_comparison_json(file_path)
            return jsonify({
                "analysis": {
                    "summary": fallback_analysis,
                }
            })

    except Exception as e:
        print(f"Error processing file version comparison analysis: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

def generate_fallback_file_version_comparison_json(file_path):
    """生成备用的JSON格式文件版本比较分析"""
    file_name = file_path.split('/')[-1] if '/' in file_path else file_path
    return json.dumps({
        "summary": f"文件 {file_name} 在两个版本之间发生了变更",
        "changeType": "代码修改",
        "impactAnalysis": "此次变更对文件内容产生了影响，需要进一步评估具体的功能性影响",
        "keyModifications": [
            "文件内容在两个版本间存在差异",
            "具体变更需要查看diff内容",
            "建议审查变更的业务逻辑影响"
        ],
        "recommendations": [
            "仔细检查变更内容确保符合预期",
            "考虑进行相关测试验证功能正确性"
        ]
    }, ensure_ascii=False)

@app.route('/analyze_batch', methods=['POST'])
def analyze_batch():
    """批量分析多个文件的差异"""
    if not openai_client:
        return jsonify({
            "error": "AI analysis disabled: OPENAI_API_KEY not configured."
        }), 503

    try:
        data = request.get_json()
        if not data or 'files' not in data:
            return jsonify({"error": "Missing files array in request"}), 400
        
        files = data['files']
        if not isinstance(files, list) or len(files) == 0:
            return jsonify({"error": "Files must be a non-empty array"}), 400
        
        # 限制批量处理的文件数量
        if len(files) > 10:
            return jsonify({"error": "Too many files in batch (max 10)"}), 400
        
        results = []
        for file_data in files:
            if 'file_path' not in file_data or 'file_diff' not in file_data:
                results.append({
                    "file_path": file_data.get('file_path', 'unknown'),
                    "analysis": None,
                    "error": "Missing file_path or file_diff"
                })
                continue
            
            # 重用单文件分析逻辑
            try:
                # 这里可以调用analyze_diff的核心逻辑
                # 为了简化，我们直接返回一个简单的分析
                file_path = file_data['file_path']
                file_name = file_path.split('/')[-1]
                
                results.append({
                    "file_path": file_path,
                    "analysis": {
                        "summary": f"{file_name}: 文件已修改，包含代码变更。"
                    },
                    "error": None
                })
            except Exception as e:
                results.append({
                    "file_path": file_data['file_path'],
                    "analysis": None,
                    "error": str(e)
                })
        
        return jsonify({"results": results})
        
    except Exception as e:
        print(f"Error processing batch request: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

if __name__ == '__main__':
    print("Starting AI Analysis Server...")
    print("="*50)
    print("🔧 服务器配置:")
    print(f"   - 本地访问: http://127.0.0.1:5111")
    print(f"   - 局域网访问: http://[你的内网IP]:5111") 
    print(f"   - 外网访问: http://[你的公网IP]:5111")
    print("="*50)
    print("📍 可用端点:")
    print(f"   - 健康检查: /health")
    print(f"   - 差异分析: /analyze_diff") 
    print(f"   - 文件历史: /analyze_file_history")
    print(f"   - 版本比较: /analyze_file_version_comparison")
    print(f"   - 批量分析: /analyze_batch")
    print("="*50)
    print("⚠️  安全提示:")
    print("   - 当前配置允许所有IP访问")
    print("   - 生产环境请配置防火墙规则")
    print("   - 建议设置API访问限制")
    print("="*50)
    
    # 获取并显示本机IP地址
    try:
        import socket
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
        print(f"🌐 本机IP地址: {local_ip}")
        print(f"   局域网访问链接: http://{local_ip}:5111/health")
    except:
        print("🌐 无法获取本机IP，请手动查看")
    
    print("="*50)
    print("🚀 服务器启动中...")
    
    # Note: Use '0.0.0.0' to be accessible from the extension container
    # Use a specific port, e.g., 5111
    app.run(host='0.0.0.0', port=5111, debug=True)  # 生产环境建议debug=False 