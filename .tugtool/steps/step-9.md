# Step 9 Checkpoint Output

## Swift project compile (scheme: Tug, not tugapp)

The plan specifies `-scheme tugapp` but the Xcode project scheme is named "Tug".
The correct invocation is:

```
cd .../tugapp && xcodebuild -scheme Tug -configuration Debug build
```

Output (tail):

```
note: Disabling hardened runtime with ad-hoc codesigning. (in target 'Tug' from project 'Tug')
** BUILD SUCCEEDED **
```
