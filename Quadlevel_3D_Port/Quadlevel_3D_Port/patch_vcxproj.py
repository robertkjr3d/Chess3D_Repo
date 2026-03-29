"""Patch vcxproj: exclude Stockfish .cpp from Debug|Win32, add debug_castle.cpp"""
import re

path = r'M:\Chess3D\Chess3D_Repo\Stockfish_3D_Port\Stockfish_3D_Port\Stockfish_3D_Port.vcxproj'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# All existing .cpp files that should be excluded from Debug|Win32
cpp_files = [
    'benchmark.cpp', 'bitboard.cpp', 'engine.cpp', 'evaluate.cpp',
    'main.cpp', 'memory.cpp', 'misc.cpp', 'movegen.cpp', 'movepick.cpp',
    r'nnue\features\full_threats.cpp', r'nnue\features\half_ka_v2_hm.cpp',
    r'nnue\network.cpp', r'nnue\nnue_accumulator.cpp', r'nnue\nnue_misc.cpp',
    'position.cpp', 'score.cpp', 'search.cpp', r'syzygy\tbprobe.cpp',
    'thread.cpp', 'timeman.cpp', 'tt.cpp', 'tune.cpp',
    'uci.cpp', 'ucioption.cpp', 'stockfish_api.cpp',
]

# Build replacement entries
exc = "      <ExcludedFromBuild Condition=\"'$(Configuration)|$(Platform)'=='Debug|Win32'\">true</ExcludedFromBuild>"
new_entries = []

# Add debug_castle.cpp (excluded from everything except Debug|Win32)
new_entries.append(
    '    <ClCompile Include="..\\..\\stockfish-src\\debug_castle.cpp">\n'
    "      <ExcludedFromBuild Condition=\"'$(Platform)'=='x64'\">true</ExcludedFromBuild>\n"
    "      <ExcludedFromBuild Condition=\"'$(Configuration)|$(Platform)'=='Release|Win32'\">true</ExcludedFromBuild>\n"
    '    </ClCompile>'
)

# Transform each existing .cpp to have ExcludedFromBuild for Debug|Win32
for cpp in cpp_files:
    inc = f'..\\..\\stockfish-src\\{cpp}'
    new_entries.append(
        f'    <ClCompile Include="{inc}">\n'
        f'{exc}\n'
        f'    </ClCompile>'
    )

new_block = '  <ItemGroup>\n' + '\n'.join(new_entries) + '\n  </ItemGroup>'

# Find and replace the existing ClCompile ItemGroup
# Match from <ItemGroup> containing ClCompile to its </ItemGroup>
pattern = r'  <ItemGroup>\s*\n(\s*<ClCompile Include="[^"]*stockfish-src[^"]*"[^/]*/>\s*\n)+\s*</ItemGroup>'
match = re.search(pattern, content)
if match:
    content = content[:match.start()] + new_block + content[match.end():]
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('SUCCESS: vcxproj patched')
else:
    print('ERROR: could not find ClCompile ItemGroup')
    # Debug: show what we see
    idx = content.find('benchmark.cpp')
    if idx >= 0:
        print(repr(content[idx-100:idx+100]))
