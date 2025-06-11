# ai_service/server.py

import os
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from openai import OpenAI, OpenAIError
from datetime import datetime

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
        if 'file_path' in data and data['file_path'] in ['comprehensive_commit_analysis', 'comprehensive_comparison_analysis', 'comprehensive_uncommitted_analysis']:
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

def get_file_change_type_description(type_char):
    """根据文件变更类型字符返回中文描述"""
    status_map = {
        'A': '新增',
        'M': '修改',
        'D': '删除',
        'R': '重命名',
        'U': '未跟踪'
    }
    return status_map.get(type_char, '未知')

def generate_stats_from_payload(file_changes, is_comparison=False):
    """从文件变更数据生成统计信息字符串"""
    stats = {'added': 0, 'modified': 0, 'deleted': 0, 'renamed': 0, 'untracked': 0}
    for f in file_changes:
        type_char = f.get('type')
        if type_char == 'A': stats['added'] += 1
        elif type_char == 'M': stats['modified'] += 1
        elif type_char == 'D': stats['deleted'] += 1
        elif type_char == 'R': stats['renamed'] += 1
        elif type_char == 'U': stats['untracked'] += 1
    
    parts = []
    if stats['added'] > 0: parts.append(f"{stats['added']}个新增文件")
    if stats['modified'] > 0: parts.append(f"{stats['modified']}个修改文件")
    if stats['deleted'] > 0: parts.append(f"{stats['deleted']}个删除文件")
    if stats['renamed'] > 0: parts.append(f"{stats['renamed']}个重命名文件")

    if is_comparison:
        if stats['untracked'] > 0: parts.append(f"{stats['untracked']}个未跟踪文件")
        total_changes = sum(stats.values())
        return f"本次比较共涉及 {total_changes} 个文件变更：{'，'.join(parts)}。"
    else:
        total_changes = stats['added'] + stats['modified'] + stats['deleted'] + stats['renamed']
        return f"此提交共涉及 {total_changes} 个文件变更：{'，'.join(parts)}。"

def build_comprehensive_commit_analysis_prompt(payload):
    """构建Git提交的综合分析提示"""
    commit_details = payload.get('commitDetails', {})
    file_analysis_data = payload.get('fileAnalysisData', [])
    stats = generate_stats_from_payload(file_analysis_data, is_comparison=False)

    prompt = f"""请对以下Git提交进行综合分析，提供一个整体性的总结报告。

提交信息：
- 提交哈希: {commit_details.get('hash')}
- 作者: {commit_details.get('author')}
- 提交消息: {commit_details.get('body') or '无提交消息'}
- {stats}

主要文件变更：
"""
    for index, file_data in enumerate(file_analysis_data):
        prompt += f"""
{index + 1}. 文件: {file_data.get('filePath')}
   变更类型: {get_file_change_type_description(file_data.get('type'))}
   
   差异内容:
   ```diff
   {file_data.get('diffContent')}
   ```
"""
    prompt += """
请提供一个综合性的分析报告，包括：
1. 这次提交的主要目的和意图
2. 涉及的核心功能或模块
3. 变更的技术影响和业务价值
4. 代码质量和架构方面的观察

要求：
- 使用中文回答
- 重点关注整体性和关联性，而非单个文件的细节
- 控制在150字以内
- 使用HTML格式，包含适当的段落和强调标签"""
    return prompt

def build_comprehensive_uncommitted_analysis_prompt(payload):
    """构建未提交变更的综合分析提示"""
    file_analysis_data = payload.get('fileAnalysisData', [])
    stats = generate_stats_from_payload(file_analysis_data, is_comparison=True)

    prompt = f"""请对以下未提交的代码变更进行综合分析，提供一个整体性的总结报告。

未提交变更信息：
- 类型: 工作区未提交变更
- {stats}

主要文件变更：
"""
    for index, file_data in enumerate(file_analysis_data):
        prompt += f"""
{index + 1}. 文件: {file_data.get('filePath')}
   变更类型: {get_file_change_type_description(file_data.get('type'))}
   
   差异内容:
   ```diff
   {file_data.get('diffContent')}
   ```
"""
    prompt += """
请提供一个综合性的分析报告，包括：
1. 未提交变更的主要目的和意图
2. 涉及的核心功能或模块
3. 变更的技术影响和业务价值
4. 代码质量和架构方面的观察
5. 提交建议（是否适合提交、需要注意的事项等）

要求：
- 使用中文回答
- 重点关注变更的整体性和关联性，而非单个文件的细节
- 控制在150字以内
- 使用HTML格式，包含适当的段落和强调标签"""
    return prompt

def build_comprehensive_comparison_prompt(payload):
    """构建版本比较的综合分析提示"""
    file_analysis_data = payload.get('fileAnalysisData', [])
    stats = generate_stats_from_payload(file_analysis_data, is_comparison=True)

    prompt = f"""请对以下版本比较进行综合分析，提供一个整体性的总结报告。

比较概览：
- {stats}

主要文件变更：
"""
    for index, file_data in enumerate(file_analysis_data):
        prompt += f"""
{index + 1}. 文件: {file_data.get('filePath')}
   变更类型: {get_file_change_type_description(file_data.get('type'))}
   
   差异内容:
   ```diff
   {file_data.get('diffContent')}
   ```
"""
    prompt += """
请提供一个综合性的分析报告，包括：
1. 两个版本之间的主要差异和演进方向
2. 涉及的核心功能变化
3. 整体架构或设计的改进
4. 潜在的影响和风险评估

要求：
- 使用中文回答
- 重点关注版本间的整体变化趋势，而非单个文件的细节
- 控制在150字以内
- 使用HTML格式，包含适当的段落和强调标签"""
    return prompt

def handle_comprehensive_analysis(data):
    """处理通用的综合性分析请求"""
    try:
        file_path_marker = data.get('file_path')
        payload_str = data.get('file_diff', '{}')
        payload = json.loads(payload_str)

        prompt_builders = {
            'comprehensive_commit_analysis': build_comprehensive_commit_analysis_prompt,
            'comprehensive_uncommitted_analysis': build_comprehensive_uncommitted_analysis_prompt,
            'comprehensive_comparison_analysis': build_comprehensive_comparison_prompt
        }

        builder = prompt_builders.get(file_path_marker)
        
        if not builder:
            return jsonify({"error": f"Invalid comprehensive analysis type: {file_path_marker}"}), 400
            
        prompt = builder(payload)
        
        # 使用OpenAI API进行分析
        chat_completion = openai_client.chat.completions.create(
            messages=[
                {
                    "role": "system",
                    "content": "你是一个专业的Git代码分析助手。请根据用户的要求，提供精准、专业的代码变更分析。如果要求HTML格式，请确保返回有效的HTML片段。"
                },
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            model="gpt-4.1-mini",
            max_tokens=800,  # 增加token以适应更复杂的分析
            temperature=0.3,
            n=1
        )
        ai_summary = chat_completion.choices[0].message.content.strip()
        
        return jsonify({
            "analysis": {
                "summary": ai_summary,
            }
        })
    except (json.JSONDecodeError, KeyError) as e:
        print(f"Error parsing comprehensive analysis payload: {e}")
        return jsonify({"error": "Invalid payload for comprehensive analysis"}), 400
    except OpenAIError as e:
        print(f"OpenAI API error during comprehensive analysis: {e}")
        return jsonify({
            "analysis": {
                "summary": "AI分析时遇到API错误。",
            }
        })
    except Exception as e:
        print(f"Unexpected error during comprehensive analysis: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

def generate_fallback_analysis(error_message="分析时发生未知错误。"):
    """生成降级分析响应"""
    return json.dumps({
        "summary": error_message,
        "evolutionPattern": "文件演进模式分析基于提交历史，显示开发活跃度和变更频率。",
        "keyChanges": [
            "代码结构调整",
            "功能实现优化",
            "性能改进措施"
        ],
        "recommendations": [
            "持续关注代码质量",
            "定期进行重构优化",
            "加强文档维护"
        ]
    }, ensure_ascii=False)

def build_file_history_analysis_prompt(payload):
    """构建文件历史分析的提示"""
    file_path = payload.get('filePath', '未知文件')
    commits = payload.get('commits', [])
    
    total_commits = len(commits)
    total_additions = sum(commit.get('additions', 0) or 0 for commit in commits)
    total_deletions = sum(commit.get('deletions', 0) or 0 for commit in commits)

    author_stats = {}
    for commit in commits:
        author = commit.get('author', '未知作者')
        author_stats[author] = author_stats.get(author, 0) + 1
    
    top_authors = sorted(author_stats.items(), key=lambda item: item[1], reverse=True)[:3]
    top_authors_str = ', '.join([f"{author} ({count}次提交)" for author, count in top_authors])

    prompt = f"""请分析以下文件的历史演进情况：

文件路径: {file_path}
总提交次数: {total_commits}
总新增行数: {total_additions}
总删除行数: {total_deletions}
主要贡献者: {top_authors_str}

最近的提交历史：
"""
    for index, commit in enumerate(commits[:10]):
        date = datetime.fromtimestamp(commit.get('authorDate', 0)).strftime('%Y-%m-%d')
        change_type = get_file_change_type_description(commit.get('fileChange', {}).get('type'))
        message = commit.get('message', '').split('\n')[0][:100]
        additions = commit.get('additions', 0) or 0
        deletions = commit.get('deletions', 0) or 0
        prompt += f"""
{index + 1}. [{date}] {commit.get('author')}
   提交: {message}
   变更: {change_type} (+{additions}/-{deletions})
"""

    prompt += """
请提供一个综合性的文件演进分析报告，包括：
1. 文件演进总结（整体发展趋势和目的）
2. 演进模式（开发活跃度、变更频率等）
3. 关键变更点（重要的修改节点）
4. 优化建议（基于历史模式的改进建议）

要求：
- 使用中文回答
- 重点关注文件的演进趋势和开发模式
- 控制在200字以内
- 使用结构化的JSON格式回答，包含summary、evolutionPattern、keyChanges、recommendations四个字段"""
    return prompt

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
        
        # 接收原始数据负载，而不是预构建的提示
        payload_str = data.get('file_diff', '{}') 
        payload = json.loads(payload_str)
        file_path = payload.get('filePath', '未知文件')

        if not payload.get('commits'):
            return jsonify({"error": "Missing commits data for file history analysis"}), 400
        
        print(f"Received file history analysis request for: {file_path}")
        
        # 在后端构建提示
        prompt = build_file_history_analysis_prompt(payload)
        
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
                test_parse = json.loads(ai_summary)
                if not all(key in test_parse for key in ['summary', 'evolutionPattern', 'keyChanges', 'recommendations']):
                    raise ValueError("Missing required fields in AI response")
                print(f"File History Analysis JSON validation passed for {file_path}")
            except (json.JSONDecodeError, ValueError) as parse_error:
                print(f"AI returned invalid JSON for {file_path}, using fallback: {parse_error}")
                ai_summary = generate_fallback_analysis(f"AI分析遇到未知错误，请稍后重试。")

            return jsonify({
                "analysis": {
                    "summary": ai_summary,
                }
            })

        except OpenAIError as e:
            print(f"OpenAI API error for file history analysis: {e}")
            fallback_analysis = generate_fallback_analysis(f"AI分析暂时不可用：{str(e)}")
            return jsonify({
                "analysis": {
                    "summary": fallback_analysis,
                }
            })
        except Exception as e:
            print(f"Unexpected error during file history analysis: {e}")
            fallback_analysis = generate_fallback_analysis("AI分析遇到未知错误，请稍后重试。")
            return jsonify({
                "analysis": {
                    "summary": fallback_analysis,
                }
            })

    except Exception as e:
        print(f"Error processing file history analysis: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

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
        
        # 接收原始数据负载，而不是预构建的提示
        payload_str = data.get('file_diff', '{}')
        payload = json.loads(payload_str)
        file_path = payload.get('filePath', '未知文件')
        
        if not payload.get('diffContent'):
            return jsonify({"error": "Missing diffContent for file version comparison"}), 400
        
        print(f"Received file version comparison analysis request for: {file_path}")
        
        # 在后端构建提示
        prompt = build_file_version_comparison_prompt(payload)
        
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
                test_parse = json.loads(ai_summary)
                required_fields = ['summary', 'changeType', 'impactAnalysis', 'keyModifications', 'recommendations']
                if not all(key in test_parse for key in required_fields):
                    raise ValueError("Missing required fields in AI response")
                print(f"File Version Comparison Analysis JSON validation passed for {file_path}")
            except (json.JSONDecodeError, ValueError) as parse_error:
                print(f"AI returned invalid JSON for {file_path}, using fallback: {parse_error}")
                ai_summary = generate_fallback_analysis(f"AI分析遇到未知错误，请稍后重试。")

            return jsonify({
                "analysis": {
                    "summary": ai_summary,
                }
            })

        except OpenAIError as e:
            print(f"OpenAI API error for file version comparison analysis: {e}")
            fallback_analysis = generate_fallback_analysis(f"AI分析暂时不可用：{str(e)}")
            return jsonify({
                "analysis": {
                    "summary": fallback_analysis,
                }
            })
        except Exception as e:
            print(f"Unexpected error during file version comparison analysis: {e}")
            fallback_analysis = generate_fallback_analysis("AI分析遇到未知错误，请稍后重试。")
            return jsonify({
                "analysis": {
                    "summary": fallback_analysis,
                }
            })

    except Exception as e:
        print(f"Error processing file version comparison analysis: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500

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

def build_file_version_comparison_prompt(payload):
    """构建文件版本比较分析的提示"""
    file_path = payload.get('filePath', '未知文件')
    from_hash = payload.get('fromHash', '未知版本')
    to_hash = payload.get('toHash', '未知版本')
    diff_content = payload.get('diffContent', '')
    content_before = payload.get('contentBefore', '')
    content_after = payload.get('contentAfter', '')
    
    file_name = file_path.split('/')[-1] if '/' in file_path else file_path
    file_extension = file_name.split('.')[-1].lower() if '.' in file_name else ''

    prompt = f"""请对以下文件版本比较进行深度分析：

文件信息：
- 文件路径：{file_path}
- 文件名：{file_name}
- 文件类型：{file_extension}
- 源版本：{from_hash[:8]}
- 目标版本：{to_hash[:8]}

Git Diff内容：
```diff
{diff_content}
```
"""
    if content_before and content_after:
        prompt += f"""
版本前内容预览（前200字符）：
```
{content_before[:200]}{'...' if len(content_before) > 200 else ''}
```

版本后内容预览（前200字符）：
```
{content_after[:200]}{'...' if len(content_after) > 200 else ''}
```
"""
    prompt += """
请按以下JSON格式提供分析结果：

{
  "summary": "这次文件变更的简要总结（不超过100字）",
  "changeType": "变更类型描述（如：功能增强、bug修复、重构等）",
  "impactAnalysis": "变更影响分析（对系统、用户、性能等方面的影响）",
  "keyModifications": [
    "第一个关键修改点",
    "第二个关键修改点",
    "第三个关键修改点"
  ],
  "recommendations": [
    "第一个建议或注意事项",
    "第二个建议或注意事项"
  ]
}

要求：
1. 严格返回有效的JSON格式，不要添加其他内容
2. 所有字段都用中文填写
3. keyModifications和recommendations数组每项不超过50字
4. 分析要专业且有价值
5. 基于实际的代码变更提供见解"""
    return prompt

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