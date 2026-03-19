import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function DisclaimerBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { t } = useI18n();

  if (dismissed) return null;

  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg bg-amber-500/10 border border-amber-500/20" data-testid="disclaimer-banner">
      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-amber-200/90 leading-relaxed">
          {t("disclaimer.text")}
        </p>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 text-amber-500/60 hover:text-amber-500 transition-colors"
        data-testid="button-dismiss-disclaimer"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
