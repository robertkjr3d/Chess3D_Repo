import os

vcxproj_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Stockfish_3D_Port.vcxproj")

with open(vcxproj_path, "r", encoding="utf-8-sig") as f:
    lines = f.readlines()

output = []
i = 0
stockfish_cpps_done = False

while i < len(lines):
    line = lines[i]
    stripped = line.strip()

    # Find ClCompile self-closing tags for stockfish-src .cpp files
    if stripped.startswith('<ClCompile Include="') and stripped.endswith('" />') and "stockfish-src" in stripped and not stockfish_cpps_done:
        # Extract the include path
        inc = stripped.split('"')[1]

        # Before the first Stockfish cpp, inject debug_castle.cpp
        if not any("debug_castle" in l for l in output):
            output.append('    <ClCompile Include="..\\..\\stockfish-src\\debug_castle.cpp">\n')
            output.append("      <ExcludedFromBuild Condition=\"'$(Platform)'=='x64'\">true</ExcludedFromBuild>\n")
            output.append("      <ExcludedFromBuild Condition=\"'$(Configuration)|$(Platform)'=='Release|Win32'\">true</ExcludedFromBuild>\n")
            output.append('    </ClCompile>\n')

        # Write this cpp with ExcludedFromBuild for Debug|Win32
        output.append('    <ClCompile Include="' + inc + '">\n')
        output.append("      <ExcludedFromBuild Condition=\"'$(Configuration)|$(Platform)'=='Debug|Win32'\">true</ExcludedFromBuild>\n")
        output.append('    </ClCompile>\n')
        i += 1
        continue

    # Skip the spurious patch_vcxproj.py None entry and its surrounding ItemGroup
    if stripped == '<None Include="patch_vcxproj.py" />':
        # Check if prev line is <ItemGroup> and next is </ItemGroup>
        if len(output) > 0 and output[-1].strip() == '<ItemGroup>':
            output.pop()  # remove the <ItemGroup>
            i += 1
            # skip </ItemGroup> if next
            if i < len(lines) and lines[i].strip() == '</ItemGroup>':
                i += 1
            continue
        i += 1
        continue

    output.append(line)
    i += 1

with open(vcxproj_path, "w", encoding="utf-8-sig") as f:
    f.writelines(output)

print("PATCHED successfully!")
print(f"Wrote {len(output)} lines to {vcxproj_path}")

# Verify
with open(vcxproj_path, "r", encoding="utf-8-sig") as f:
    content = f.read()

count_excluded = content.count("ExcludedFromBuild")
count_debug_castle = content.count("debug_castle")
print(f"ExcludedFromBuild occurrences: {count_excluded}")
print(f"debug_castle occurrences: {count_debug_castle}")
