# Feature — Sessions & workspaces

## Data Model

```
machine / user / session_name
     │      │         │
     │      │         └── short identifier (e.g. CURSOR, NOW2, Interface)
     │      └── remote Linux user (e.g. zaza)
     └── SSH host or bridge node (e.g. asus, acer, gbs-h1)
```

- **Bookmarkable URL:** `/console/asus/zaza/CURSOR`
- **Absolute workspace:** registered separately via `POST /api/conversations/register`
- **UI Title:** `asus / zaza / CURSOR` (last segment of workspace, not the full path)

## New Session Stepper

Component: `src/components/ConversationStepper.jsx`

| Step | Validation | UI |
|------|------------|----|
| Machine | selected host | Searchable `PickerMenu`, tall modal (~90% viewport) |
| User | non-empty | select + free input, options from machines + zaza/helm-v2/root/xavier |
| Path | starts with `/` | `WorkspacePicker` |
| Confirm | path + workspace | editable session name, preview |

### Auto Session Name

```javascript
// src/lib/workspaceTemplates.js
sessionNameFromPath('/home/zaza/Bureau/CURSOR') // → 'CURSOR'
sessionNameFromPath('/apps/helm-v2/app')        // → 'helm-v2'
```

Flag `sessionNameTouched`: if the user edits the name, do not overwrite with auto name anymore.

## Remote Explorer (WorkspacePicker)

`src/components/WorkspacePicker.jsx`

- Quick roots: `~`, `~/Bureau`, `/apps/{user}/…`
- Breadcrumb + folder list
- API: `GET /api/fs/browse?machine=&user=&path=`

Backend: `server/lib/remoteFs.js`

1. Tries bridge `GET /api/fs/list` if bridged machine
2. Otherwise direct SSH (`ls` without broken sudo)

## Session Registration

```javascript
// client
registerConversation({ path: 'asus/zaza/CURSOR', workspace: '/home/zaza/Bureau/CURSOR' })
```

Server: `setConversationWorkspace` → bridge `POST /api/conversations/workspace`

## List / Header Display

`src/components/ConversationListItem.jsx` → `sessionTriple()`

```javascript
{
  machine, user, project,  // project = short label (CURSOR)
  cwd,                     // full workspace path (tooltip)
  label,                   // sessionNameFromPath(cwd) || project
}
```

## Known Machines (July 2026)

| Machine | Bridge | Browse FS | Usage |
|---------|--------|-----------|-------|
| gbs-h1 | yes :4310 | yes | helm-v2 dev |
| acer | yes | yes | NOW2 zaza |
| asus | yes (health OK) | SSH fallback | CURSOR / NOW3 |

## Agent Traps

1. **Do not** create `gbs-h1/zaza/NOW2` if the project lives on **acer**
2. Purge orphan h1 sessions in case of historical misrouting
3. Session **name** (`NOW3`) ≠ workspace folder if misconfigured — UI title prioritizes **cwd**
4. 744 SSH hosts in config → machine modal in `tall` mode + mandatory search

## Tests

`src/lib/workspaceTemplates.test.js`
