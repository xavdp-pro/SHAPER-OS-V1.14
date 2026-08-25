import { useEffect } from 'react';
import { getHelmClientId, openOperatorSyncStream } from '../api/client.js';
import { useLocale } from '../context/LocaleContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';

/** Keep UI language and AI model choices aligned across tabs/devices for the logged-in operator. */
export default function OperatorLocaleSync() {
  const { setLocale } = useLocale();
  const { applyRemoteModelChange, refresh } = useSettings();

  useEffect(() => {
    const close = openOperatorSyncStream((event) => {
      if (!event) return;
      if (event.clientId && event.clientId === getHelmClientId()) return;

      if (event.type === 'locale' && event.locale) {
        setLocale(event.locale, { broadcast: false });
      } else if (event.type === 'model_change') {
        applyRemoteModelChange({
          modelFamily: event.modelFamily,
          modelLabel: event.modelLabel,
          modelEffort: event.modelEffort,
          modelFast: event.modelFast,
        });
      } else if (event.type === 'settings_updated') {
        void refresh();
      }
    });
    return close;
  }, [setLocale, applyRemoteModelChange, refresh]);

  return null;
}
