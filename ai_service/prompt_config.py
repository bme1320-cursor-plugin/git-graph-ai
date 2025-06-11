# ai_service/prompt_config.py
from datetime import datetime

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

def build_analyze_diff_prompt(file_path, file_extension, file_name, file_diff):
    """构建单文件差异分析的提示"""
    return f"""
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

def build_enhanced_file_history_prompt(prompt):
    """为文件历史分析构建增强的提示"""
    return f"""
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