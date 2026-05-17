"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog heading, e.g. "Deposit", "Withdraw", "Spend". */
  title: string;
  /** One-line context under the heading. */
  description?: string;
  /** Label above the amount input. Defaults to a generic "Amount". */
  amountLabel?: string;
  /** When true, shows a second freeform "Reason" field (used by the kid spend flow). */
  withReason?: boolean;
  /** Label above the reason input, when shown. */
  reasonLabel?: string;
  /** Text on the confirm button. */
  confirmLabel: string;
  /** Currency code shown next to the amount field. Informational only. */
  currency?: string;
  /** Called with positive integer cents (+ optional reason text). */
  onConfirm: (cents: number, reason?: string) => void | Promise<void>;
  /** Disables the confirm button while a parent mutation is in flight. */
  isSubmitting?: boolean;
}

/**
 * Shared amount-entry modal used by:
 *   - `/settings/pocket-money` deposit + withdrawal (parent)
 *   - `/pocket-money` spend request (kid)
 *
 * Replaces three separate `window.prompt()` calls that were ugly,
 * un-styleable, and didn't support a Reason field (kid flow had to
 * fire two prompts back-to-back). Numeric input, validated to > 0,
 * confirm disabled until valid.
 */
export function AmountDialog({
  open,
  onOpenChange,
  title,
  description,
  amountLabel,
  withReason = false,
  reasonLabel,
  confirmLabel,
  currency = "EUR",
  onConfirm,
  isSubmitting = false,
}: Props) {
  const t = useTranslations("pocketMoney");
  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  // Reset state every time the dialog opens so a previous attempt's
  // value doesn't leak into the next interaction.
  useEffect(() => {
    if (open) {
      setAmount("");
      setReason("");
    }
  }, [open]);

  const cents = Math.round(Number(amount.replace(",", ".")) * 100);
  const valid = Number.isFinite(cents) && cents > 0;

  const handleSubmit = async () => {
    if (!valid) return;
    await onConfirm(cents, withReason ? reason.trim() : undefined);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="amount-dialog-amount">
              {amountLabel ?? t("amountLabel")} ({currency})
            </Label>
            <Input
              id="amount-dialog-amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid && !withReason) handleSubmit();
              }}
              placeholder="5.00"
            />
          </div>

          {withReason && (
            <div className="space-y-1">
              <Label htmlFor="amount-dialog-reason">
                {reasonLabel ?? t("reasonLabel")}
              </Label>
              <Input
                id="amount-dialog-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid) handleSubmit();
                }}
                placeholder=""
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={!valid || isSubmitting}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
