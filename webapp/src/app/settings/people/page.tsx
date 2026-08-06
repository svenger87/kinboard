"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { Users, Plus, Pencil, Trash2, User, ImagePlus, Link, Upload, Loader2, GraduationCap, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Person } from "@/types/database";
import { usePeople, useCreatePerson, useUpdatePerson, useDeletePerson } from "@/hooks";
import { ImageCropper } from "@/components/image-cropper";
import { PageHeader } from "@/components/page-header";
import { personRoleLabel } from "@/lib/person-role";

// Preset colors for family members
const PRESET_COLORS = [
  "#3b82f6", // Blue
  "#ec4899", // Pink
  "#a855f7", // Purple
  "#22c55e", // Green
  "#f97316", // Orange
  "#06b6d4", // Cyan
  "#eab308", // Yellow
  "#ef4444", // Red
];

// Preset avatar emojis
const PRESET_AVATARS = [
  "👨", "👩", "👦", "👧", "👴", "👵",
  "🧔", "👱", "👸", "🤴", "🧑", "👶",
  "🐱", "🐶", "🦊", "🐼", "🐨", "🦁",
];

// Helper to check if avatar is emoji (not a URL or data URL)
const isEmojiAvatar = (avatar: string | null): boolean => {
  if (!avatar) return false;
  return !avatar.startsWith("http") && !avatar.startsWith("data:");
};

// Helper to check if avatar is an uploaded file (data URL)
const isUploadedAvatar = (avatar: string | null): boolean => {
  if (!avatar) return false;
  return avatar.startsWith("data:");
};

export default function PeopleSettingsPage() {
  const t = useTranslations("settings.people");

  // Fetch people from Supabase
  const { data: people = [], isLoading, error, refetch } = usePeople();
  const createPerson = useCreatePerson();
  const updatePerson = useUpdatePerson();
  const deletePerson = useDeletePerson();

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
  const [newAvatar, setNewAvatar] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [isChild, setIsChild] = useState(false);
  const [birthDate, setBirthDate] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Image cropper state
  const [cropperImage, setCropperImage] = useState<string | null>(null);
  const [isCropperOpen, setIsCropperOpen] = useState(false);

  const isSaving = createPerson.isPending || updatePerson.isPending || deletePerson.isPending;

  const resetForm = () => {
    setNewName("");
    setNewColor(PRESET_COLORS[people.length % PRESET_COLORS.length]);
    setNewAvatar(null);
    setAvatarUrl("");
    setUploadedFile(null);
    setIsChild(false);
    setBirthDate("");
    setCropperImage(null);
    setIsCropperOpen(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      alert(t("alertImageType"));
      return;
    }

    // Validate file size (max 10MB for cropping, will be compressed after)
    if (file.size > 10 * 1024 * 1024) {
      alert(t("alertImageSize"));
      return;
    }

    // Convert to base64 and open cropper
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      setCropperImage(result);
      setIsCropperOpen(true);
    };
    reader.readAsDataURL(file);

    // Reset file input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleCropComplete = (croppedImage: string) => {
    setUploadedFile(croppedImage);
    setNewAvatar(null);
    setAvatarUrl("");
    setCropperImage(null);
  };

  const handleAddPerson = async () => {
    if (!newName.trim()) return;

    // Priority: uploaded file > emoji > URL
    const avatarValue = uploadedFile || newAvatar || (avatarUrl.trim() || null);

    try {
      await createPerson.mutateAsync({
        name: newName.trim(),
        color: newColor,
        avatar_url: avatarValue || undefined,
        is_child: isChild,
        birth_date: birthDate || null,
      });
      resetForm();
      setIsAddDialogOpen(false);
    } catch {
      toast.error(t("toastAddFailed"));
    }
  };

  const handleEditPerson = async () => {
    if (!editingPerson || !newName.trim()) return;

    // Priority: uploaded file > emoji > URL
    const avatarValue = uploadedFile || newAvatar || (avatarUrl.trim() || null);

    try {
      await updatePerson.mutateAsync({
        id: editingPerson.id,
        name: newName.trim(),
        color: newColor,
        avatar_url: avatarValue,
        is_child: isChild,
        birth_date: birthDate || null,
      });
      setEditingPerson(null);
      resetForm();
    } catch {
      toast.error(t("toastUpdateFailed"));
    }
  };

  const handleDeletePerson = async (id: string) => {
    try {
      await deletePerson.mutateAsync(id);
    } catch {
      toast.error(t("toastDeleteFailed"));
    }
  };

  const openEditDialog = (person: Person) => {
    setEditingPerson(person);
    setNewName(person.name);
    setNewColor(person.color);
    setIsChild(person.is_child || false);
    setBirthDate(person.birth_date ?? "");

    // Determine avatar type: emoji, uploaded (data URL), or external URL
    if (person.avatar_url && isEmojiAvatar(person.avatar_url)) {
      setNewAvatar(person.avatar_url);
      setAvatarUrl("");
      setUploadedFile(null);
    } else if (person.avatar_url && person.avatar_url.startsWith("data:")) {
      setUploadedFile(person.avatar_url);
      setNewAvatar(null);
      setAvatarUrl("");
    } else {
      setNewAvatar(null);
      setAvatarUrl(person.avatar_url || "");
      setUploadedFile(null);
    }
  };

  // Determine default tab based on current avatar
  const getDefaultTab = () => {
    if (uploadedFile) return "upload";
    if (avatarUrl) return "url";
    return "emoji";
  };

  // Avatar picker component
  const AvatarPicker = () => (
    <div className="flex flex-col gap-3">
      <Label>{t("avatarLabel")}</Label>
      <Tabs defaultValue={getDefaultTab()} className="w-full">
        <TabsList className="w-full">
          <TabsTrigger value="emoji" className="flex-1">
            <span className="mr-1">😀</span> {t("avatarTabEmoji")}
          </TabsTrigger>
          <TabsTrigger value="upload" className="flex-1">
            <Upload className="size-3 mr-1" /> {t("avatarTabUpload")}
          </TabsTrigger>
          <TabsTrigger value="url" className="flex-1">
            <Link className="size-3 mr-1" /> {t("avatarTabUrl")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="emoji" className="mt-3">
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
            {PRESET_AVATARS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setNewAvatar(emoji);
                  setAvatarUrl("");
                  setUploadedFile(null);
                }}
                className={`size-10 text-2xl rounded-lg flex items-center justify-center transition-all hover:bg-muted ${
                  newAvatar === emoji
                    ? "ring-2 ring-primary bg-primary/10"
                    : "bg-muted/50"
                }`}
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setNewAvatar(null);
                setAvatarUrl("");
                setUploadedFile(null);
              }}
              className={`size-10 text-sm rounded-lg flex items-center justify-center transition-all hover:bg-muted ${
                !newAvatar && !avatarUrl && !uploadedFile
                  ? "ring-2 ring-primary bg-primary/10"
                  : "bg-muted/50"
              }`}
            >
              <User className="size-5 text-muted-foreground" />
            </button>
          </div>
        </TabsContent>
        <TabsContent value="upload" className="mt-3">
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
          <div
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
            role="button"
            tabIndex={0}
            aria-label={t("uploadAria")}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors hover:border-primary hover:bg-primary/5 ${
              uploadedFile ? "border-primary bg-primary/10" : "border-muted-foreground/30"
            }`}
          >
            {uploadedFile ? (
              <div className="flex flex-col items-center gap-2">
                { }
                <img
                  src={uploadedFile}
                  alt="Uploaded avatar"
                  className="size-16 rounded-full object-cover"
                />
                <p className="text-sm text-muted-foreground">
                  {t("uploadChange")}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <ImagePlus className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">{t("uploadEmpty")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("uploadHint")}
                </p>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {t("uploadTransientHint")}
          </p>
        </TabsContent>
        <TabsContent value="url" className="mt-3">
          <Input
            placeholder={t("urlPlaceholder")}
            value={avatarUrl}
            onChange={(e) => {
              setAvatarUrl(e.target.value);
              setNewAvatar(null);
              setUploadedFile(null);
            }}
          />
          <p className="text-xs text-muted-foreground mt-2">
            {t("urlHint")}
          </p>
        </TabsContent>
      </Tabs>

      {/* Preview */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
        <span className="text-sm text-muted-foreground">{t("previewLabel")}</span>
        <div
          className="size-12 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
          style={{
            backgroundColor: `${newColor}20`,
            border: `2px solid ${newColor}`,
          }}
        >
          {newAvatar ? (
            <span className="text-2xl">{newAvatar}</span>
          ) : uploadedFile ? (
             
            <img
              src={uploadedFile}
              alt="Avatar preview"
              className="size-full object-cover"
            />
          ) : avatarUrl ? (

            // JSX attribute interpolation: React calls setAttribute under
            // the hood, which doesn't reinterpret the string as HTML.
            // `<img src=javascript:...>` doesn't execute JS in modern
            // browsers (img elements only fetch URLs as image data). Even
            // if avatarUrl came from an attacker-controlled source, the
            // worst case is a broken image — no XSS surface here.
            // (CodeQL #22 dismissed: false positive — JSX attr escaping.)
            <img
              src={avatarUrl}
              alt="Avatar preview"
              className="size-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <User className="size-6" style={{ color: newColor }} />
          )}
        </div>
        <span className="font-medium">{newName || t("previewName")}</span>
      </div>
    </div>
  );

  // Loading state
  if (isLoading) {
    return (
      <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-2xl mx-auto">
          <PageHeader
            icon={Users}
            title={t("title")}
            subtitle={<Skeleton className="h-4 w-20" />}
            backHref="/settings"
            className="mb-8"
          />
          <Card className="divide-y divide-border/50">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 p-4">
                <Skeleton className="size-12 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-3 w-16 mt-2" />
                </div>
              </div>
            ))}
          </Card>
        </div>
      </main>
    );
  }

  // Error state
  if (error) {
    return (
      <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
        <div className="relative z-10 max-w-2xl mx-auto">
          <Card className="p-8 text-center">
            <Users className="size-12 mx-auto mb-3 text-destructive opacity-50" />
            <p className="text-destructive font-medium">{t("loadErrorTitle")}</p>
            <p className="text-sm text-muted-foreground mt-1">
              {t("loadErrorDescription")}
            </p>
            <Button
              variant="outline"
              onClick={() => refetch()}
              className="mt-4"
            >
              <RefreshCw className="size-4 mr-2" />
              {t("retryButton")}
            </Button>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-page p-4 pt-16 md:p-8 md:pt-20 relative safe-area-inset">
      <div className="relative z-10 max-w-2xl mx-auto">
        {/* Header + Add Dialog */}
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <PageHeader
            icon={Users}
            title={t("title")}
            subtitle={t("subtitleCount", { count: people.length })}
            backHref="/settings"
            className="mb-8"
            actions={
              <DialogTrigger asChild>
                <Button size="sm" className="flex-shrink-0">
                  <Plus className="size-4 mr-1" />
                  {t("addButton")}
                </Button>
              </DialogTrigger>
            }
          />
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{t("addDialogTitle")}</DialogTitle>
                <DialogDescription>
                  {t("addDialogDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="name">{t("nameLabel")}</Label>
                  <Input
                    id="name"
                    placeholder={t("namePlaceholder")}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor="is-child" className="flex items-center gap-2">
                      <GraduationCap className="size-4" />
                      {t("isChildLabel")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t("isChildDescription")}
                    </p>
                  </div>
                  <Switch
                    id="is-child"
                    checked={isChild}
                    onCheckedChange={setIsChild}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="birth-date">{t("birthDateLabel")}</Label>
                  <Input
                    id="birth-date"
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t("colorLabel")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewColor(color)}
                        className={`size-8 rounded-full transition-transform ${
                          newColor === color ? "ring-2 ring-offset-2 ring-offset-background ring-white scale-110" : ""
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                <AvatarPicker />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setIsAddDialogOpen(false); resetForm(); }} disabled={isSaving}>
                  {t("cancelButton")}
                </Button>
                <Button onClick={handleAddPerson} disabled={!newName.trim() || isSaving}>
                  {createPerson.isPending ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      {t("savingLabel")}
                    </>
                  ) : (
                    t("addSubmitButton")
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* People List */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="divide-y divide-border/50">
            <AnimatePresence>
              {people.map((person, index) => (
                <motion.div
                  key={person.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center gap-4 p-4"
                >
                  {/* Avatar */}
                  <div
                    className="size-12 rounded-full flex items-center justify-center shrink-0 overflow-hidden"
                    style={{
                      backgroundColor: `${person.color}20`,
                      border: `2px solid ${person.color}`,
                    }}
                  >
                    {person.avatar_url && isEmojiAvatar(person.avatar_url) ? (
                      <span className="text-2xl">{person.avatar_url}</span>
                    ) : person.avatar_url && (isUploadedAvatar(person.avatar_url) || person.avatar_url.startsWith("http")) ? (
                       
                      <img
                        src={person.avatar_url}
                        alt={person.name}
                        className="size-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <User className="size-6" style={{ color: person.color }} />
                    )}
                  </div>

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-lg">{person.name}</p>
                      {person.is_child && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          <GraduationCap className="size-3" />
                          {t("childBadge")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {personRoleLabel(person.is_child, person.birth_date, {
                        parent: t("roleParent"),
                        child: t("roleChild"),
                        years: (n) => t("ageYears", { count: n }),
                      })}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div
                        className="size-3 rounded-full"
                        style={{ backgroundColor: person.color }}
                      />
                      <span className="text-xs text-muted-foreground uppercase">
                        {person.color}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1">
                    <Dialog
                      open={editingPerson?.id === person.id}
                      onOpenChange={(open) => {
                        if (!open) setEditingPerson(null);
                      }}
                    >
                      <DialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(person)}
                          aria-label={t("editAria", { name: person.name })}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-md">
                        <DialogHeader>
                          <DialogTitle>{t("editDialogTitle")}</DialogTitle>
                        </DialogHeader>
                        <div className="flex flex-col gap-4 py-4">
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="edit-name">{t("nameLabel")}</Label>
                            <Input
                              id="edit-name"
                              value={newName}
                              onChange={(e) => setNewName(e.target.value)}
                            />
                          </div>
                          <div className="flex items-center justify-between rounded-lg border p-3">
                            <div className="flex flex-col gap-0.5">
                              <Label htmlFor="edit-is-child" className="flex items-center gap-2">
                                <GraduationCap className="size-4" />
                                {t("isChildLabel")}
                              </Label>
                              <p className="text-xs text-muted-foreground">
                                {t("isChildDescription")}
                              </p>
                            </div>
                            <Switch
                              id="edit-is-child"
                              checked={isChild}
                              onCheckedChange={setIsChild}
                            />
                          </div>
                          <div className="flex flex-col gap-2">
                            <Label htmlFor="edit-birth-date">{t("birthDateLabel")}</Label>
                            <Input
                              id="edit-birth-date"
                              type="date"
                              value={birthDate}
                              onChange={(e) => setBirthDate(e.target.value)}
                            />
                          </div>
                          <div className="flex flex-col gap-2">
                            <Label>{t("colorLabel")}</Label>
                            <div className="flex flex-wrap gap-2">
                              {PRESET_COLORS.map((color) => (
                                <button
                                  key={color}
                                  type="button"
                                  onClick={() => setNewColor(color)}
                                  className={`size-8 rounded-full transition-transform ${
                                    newColor === color
                                      ? "ring-2 ring-offset-2 ring-offset-background ring-white scale-110"
                                      : ""
                                  }`}
                                  style={{ backgroundColor: color }}
                                />
                              ))}
                            </div>
                          </div>
                          <AvatarPicker />
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => { setEditingPerson(null); resetForm(); }} disabled={isSaving}>
                            {t("cancelButton")}
                          </Button>
                          <Button onClick={handleEditPerson} disabled={!newName.trim() || isSaving}>
                            {updatePerson.isPending ? (
                              <>
                                <Loader2 className="size-4 mr-2 animate-spin" />
                                {t("savingLabel")}
                              </>
                            ) : (
                              t("saveSubmitButton")
                            )}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>

                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label={t("deleteAria")}>
                          <Trash2 className="size-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{t("deleteDialogTitle")}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {t("deleteDialogDescription", { name: person.name })}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("deleteCancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => handleDeletePerson(person.id)}
                          >
                            {t("deleteConfirm")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {people.length === 0 && (
              <div className="p-8 text-center text-muted-foreground">
                <Users className="size-12 mx-auto mb-3 opacity-50" />
                <p>{t("emptyTitle")}</p>
                <p className="text-sm">{t("emptyDescription")}</p>
              </div>
            )}
          </Card>
        </motion.div>
      </div>

      {/* Image Cropper Dialog */}
      {cropperImage && (
        <ImageCropper
          image={cropperImage}
          open={isCropperOpen}
          onClose={() => {
            setIsCropperOpen(false);
            setCropperImage(null);
          }}
          onCropComplete={handleCropComplete}
          cropShape="round"
          aspectRatio={1}
        />
      )}
    </main>
  );
}
