"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, Server } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataLocationNote, PushContactField, SiteAddressField } from "@/components/setup/instance-fields";
import { useInstanceSetup, useSaveInstanceSetup } from "@/hooks/use-instance-setup";
import { normaliseSiteUrl, normaliseVapidSubject } from "@/lib/first-run";

/**
 * Settings → This install: the first-run sequence's install steps found
 * again (RFC-024 §8, "every step can be found again in Settings"). Shown
 * only to the install's operator; for every other family it renders nothing.
 */
export function InstanceCard() {
  const t = useTranslations("settings.instance");
  const { data: instance } = useInstanceSetup();
  const save = useSaveInstanceSetup();
  const [address, setAddress] = useState<string | null>(null);
  const [contact, setContact] = useState<string | null>(null);
  const [addressInvalid, setAddressInvalid] = useState(false);
  const [contactInvalid, setContactInvalid] = useState(false);

  if (!instance?.operator) return null;

  const storedAddress = instance.siteUrl?.source === "install" ? (instance.siteUrl.value ?? "") : "";
  const storedContact = instance.pushContact?.source === "install" ? (instance.pushContact.value ?? "") : "";
  const addressValue = address ?? storedAddress;
  const contactValue = contact ?? storedContact;
  const dirty = (address !== null && address !== storedAddress) || (contact !== null && contact !== storedContact);

  const onSave = () => {
    const values: { site_url?: string | null; vapid_subject?: string | null } = {};
    if (address !== null && address !== storedAddress) {
      if (address.trim() === "") values.site_url = null;
      else {
        const v = normaliseSiteUrl(address);
        if (!v) return setAddressInvalid(true);
        values.site_url = v;
      }
    }
    if (contact !== null && contact !== storedContact) {
      if (contact.trim() === "") values.vapid_subject = null;
      else {
        const v = normaliseVapidSubject(contact);
        if (!v) return setContactInvalid(true);
        values.vapid_subject = v;
      }
    }
    save.mutate(values, {
      onSuccess: () => {
        setAddress(null);
        setContact(null);
        toast.success(t("saved"));
      },
      onError: (err) => {
        if (err instanceof Error && err.message === "pin_required") return;
        toast.error(t("saveFailed"));
      },
    });
  };

  return (
    // No data-setting: the settings search lists the same entries for every
    // family, and this card exists only for the install's operator.
    <div id="instance" className="mb-6" data-testid="instance-card">
      <h2 className="text-kiosk-label mb-3 px-1">{t("title")}</h2>
      <Card className="p-4 space-y-6">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-primary/10 shrink-0">
            <Server className="size-5 text-primary" strokeWidth={1.75} />
          </div>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <SiteAddressField
          value={addressValue}
          onChange={(v) => {
            setAddress(v);
            setAddressInvalid(false);
          }}
          source={instance.siteUrl?.source}
          inForce={instance.siteUrl?.value}
          invalid={addressInvalid}
          disabled={save.isPending}
        />
        <PushContactField
          value={contactValue}
          onChange={(v) => {
            setContact(v);
            setContactInvalid(false);
          }}
          source={instance.pushContact?.source}
          inForce={instance.pushContact?.value}
          invalid={contactInvalid}
          disabled={save.isPending}
        />
        <DataLocationNote />
        <Button size="sm" onClick={onSave} disabled={!dirty || save.isPending} data-testid="instance-save">
          {save.isPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Check className="size-4 mr-1" />}
          {t("save")}
        </Button>
      </Card>
    </div>
  );
}
