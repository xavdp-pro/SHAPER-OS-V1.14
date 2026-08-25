import { useMemo, useState } from "react";
import { useLocale } from "../context/LocaleContext.jsx";
import { useSettings } from "../context/SettingsContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import PickerMenu from "./PickerMenu.jsx";

const LABELS = {
  agy: "Antigravity",
  cursor: "Cursor",
  claude: "Claude Code",
  opencode: "OpenCode",
};

/** Pick live CLI engine from enabled plugins. Default today is agy. */
export default function AgentPluginToggle({ compact = false, menu = false }) {
  const { t } = useLocale();
  const { pushToast } = useToast();
  const { agentPlugin = "agy", activePlugins = [], plugins = [], setAgentPlugin } = useSettings();
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => {
    const source = activePlugins.length
      ? activePlugins
      : plugins.filter((p) => p.enabled !== false);
    return source.map((p) => ({
      value: p.id,
      label: LABELS[p.id] || p.name || p.id,
    }));
  }, [activePlugins, plugins]);

  if (options.length < 1) return null;

  const apply = async (plugin) => {
    if (saving || !setAgentPlugin || plugin === agentPlugin) return;
    setSaving(true);
    const res = await setAgentPlugin(plugin);
    setSaving(false);
    if (!res.ok) {
      pushToast(res.error || t("model.saveError"), { type: "error" });
      return;
    }
    const label = LABELS[res.agentPlugin] || res.agentPlugin;
    pushToast(t("cli.active").replace("{label}", label), { type: "success" });
  };

  const pickerClass = menu ? "w-full" : (compact ? "picker-compact w-[7rem]" : "picker-compact w-[8.5rem]");

  return (
    <PickerMenu
      value={agentPlugin}
      options={options}
      disabled={saving}
      searchable={false}
      inline={menu}
      placeholder={t("options.engine")}
      className={pickerClass}
      onChange={apply}
    />
  );
}
