"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import {
  Search,
  Upload,
  Camera,
  X,
  Loader2,
  ImageIcon,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GlassCard } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useFamilyStore } from "@/stores/family-store";

interface RecipeImagePickerProps {
  value?: string | null;
  onChange: (url: string | null) => void;
  recipeName?: string;
}

interface SearchResult {
  url: string;
  thumbnail: string;
  title: string;
  source: string;
}

export function RecipeImagePicker({
  value,
  onChange,
  recipeName = "",
}: RecipeImagePickerProps) {
  const t = useTranslations("components.recipeImagePicker");
  const { family } = useFamilyStore();
  const [activeTab, setActiveTab] = useState<"search" | "upload" | "camera">("search");

  // Search state
  const [searchQuery, setSearchQuery] = useState(recipeName);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Camera state
  const [hasCamera, setHasCamera] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Check for camera availability
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.mediaDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const hasVideoInput = devices.some((d) => d.kind === "videoinput");
        setHasCamera(hasVideoInput);
      });
    }
  }, []);

  // Update search query when recipe name changes
  useEffect(() => {
    if (recipeName && !hasSearched) {
      setSearchQuery(recipeName);
    }
  }, [recipeName, hasSearched]);

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cameraStream]);

  // Search for images
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setHasSearched(true);

    try {
      const res = await fetch(
        `/api/images/search?q=${encodeURIComponent(searchQuery + " " + t("searchAppend"))}&limit=12`
      );
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (error) {
      console.error("Image search failed:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle file upload
  const handleFileUpload = async (file: File) => {
    if (!family?.id) return;

    // Validate file
    if (!file.type.startsWith("image/")) {
      alert(t("alertImageType"));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert(t("alertImageSize"));
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("family_id", family.id);

      const res = await fetch("/api/recipes/upload-image", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Upload failed");
      }

      const data = await res.json();
      onChange(data.url);
    } catch (error) {
      console.error("Upload failed:", error);
      alert(t("alertUploadFailed"));
    } finally {
      setIsUploading(false);
    }
  };

  // Handle file input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  // Handle drag and drop
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileUpload(file);
    }
  };

  // Start camera
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      setCameraStream(stream);
      setIsCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error("Camera access failed:", error);
      alert(t("alertCameraDenied"));
    }
  };

  // Stop camera
  const stopCamera = useCallback(() => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
    setIsCameraActive(false);
  }, [cameraStream]);

  // Capture photo
  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current || !family?.id) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    // Set canvas size to video size
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0);

    // Convert to blob
    canvas.toBlob(
      async (blob) => {
        if (!blob) return;

        stopCamera();
        setIsUploading(true);

        try {
          const file = new File([blob], "camera-photo.jpg", { type: "image/jpeg" });
          const formData = new FormData();
          formData.append("image", file);
          formData.append("family_id", family.id);

          const res = await fetch("/api/recipes/upload-image", {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            throw new Error("Upload failed");
          }

          const data = await res.json();
          onChange(data.url);
        } catch (error) {
          console.error("Photo upload failed:", error);
          alert(t("alertUploadFailed"));
        } finally {
          setIsUploading(false);
        }
      },
      "image/jpeg",
      0.9
    );
  };

  // Stop camera when leaving camera tab
  useEffect(() => {
    if (activeTab !== "camera" && isCameraActive) {
      stopCamera();
    }
  }, [activeTab, isCameraActive, stopCamera]);

  return (
    <div className="flex flex-col gap-4">
      {/* Current image preview */}
      {value && (
        <div className="relative">
          <div className="relative aspect-video rounded-xl overflow-hidden bg-muted">
            <img
              src={value}
              alt={t("imageAlt")}
              className="size-full object-cover"
            />
            <Button
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2"
              onClick={() => onChange(null)}
              aria-label={t("removeAria")}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Image picker tabs */}
      {!value && (
        <GlassCard className="p-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <TabsList className="w-full grid grid-cols-3 mb-4">
              <TabsTrigger value="search" className="gap-2">
                <Search className="size-4" />
                <span className="hidden sm:inline">{t("tabSearch")}</span>
              </TabsTrigger>
              <TabsTrigger value="upload" className="gap-2">
                <Upload className="size-4" />
                <span className="hidden sm:inline">{t("tabUpload")}</span>
              </TabsTrigger>
              <TabsTrigger value="camera" className="gap-2" disabled={!hasCamera}>
                <Camera className="size-4" />
                <span className="hidden sm:inline">{t("tabCamera")}</span>
              </TabsTrigger>
            </TabsList>

            {/* Search Tab */}
            <TabsContent value="search" className="flex flex-col gap-4">
              <div className="flex gap-2">
                <Input
                  placeholder={t("searchPlaceholder")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                <Button onClick={handleSearch} disabled={isSearching}>
                  {isSearching ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Search className="size-4" />
                  )}
                </Button>
              </div>

              <AnimatePresence mode="wait">
                {isSearching ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center justify-center py-8"
                  >
                    <Loader2 className="size-8 animate-spin text-muted-foreground" />
                  </motion.div>
                ) : searchResults.length > 0 ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto"
                  >
                    {searchResults.map((result, i) => (
                      <motion.button
                        key={i}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: i * 0.05 }}
                        onClick={() => onChange(result.url)}
                        className="relative aspect-square rounded-lg overflow-hidden bg-muted hover:ring-2 hover:ring-month-primary transition-all"
                      >
                        <img
                          src={result.thumbnail || result.url}
                          alt={result.title}
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      </motion.button>
                    ))}
                  </motion.div>
                ) : hasSearched ? (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center py-8 text-muted-foreground"
                  >
                    <ImageIcon className="size-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">{t("searchEmpty")}</p>
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center py-8 text-muted-foreground"
                  >
                    <Search className="size-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">{t("searchPrompt")}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </TabsContent>

            {/* Upload Tab */}
            <TabsContent value="upload" className="flex flex-col gap-4">
              <div
                className={cn(
                  "border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer",
                  dragOver
                    ? "border-month-primary bg-month-primary/5"
                    : "border-border hover:border-month-primary/50"
                )}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />

                {isUploading ? (
                  <div className="flex flex-col gap-2">
                    <Loader2 className="size-8 mx-auto animate-spin text-month-primary" />
                    <p className="text-sm text-muted-foreground">{t("uploading")}</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Upload className="size-8 mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {t("uploadHint")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("uploadFormat")}
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Camera Tab */}
            <TabsContent value="camera" className="flex flex-col gap-4">
              <div className="relative aspect-video rounded-xl overflow-hidden bg-black">
                {isCameraActive ? (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="size-full object-cover"
                    />
                    <canvas ref={canvasRef} className="hidden" />
                  </>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Camera className="size-12 text-muted-foreground/50" />
                  </div>
                )}

                {isUploading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Loader2 className="size-8 animate-spin text-white" />
                  </div>
                )}
              </div>

              <div className="flex justify-center gap-2">
                {!isCameraActive ? (
                  <Button onClick={startCamera} variant="month">
                    <Camera className="size-4 mr-2" />
                    {t("cameraStart")}
                  </Button>
                ) : (
                  <>
                    <Button onClick={stopCamera} variant="outline">
                      <X className="size-4 mr-2" />
                      {t("cameraCancel")}
                    </Button>
                    <Button onClick={capturePhoto} variant="month" disabled={isUploading}>
                      <Check className="size-4 mr-2" />
                      {t("cameraCapture")}
                    </Button>
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </GlassCard>
      )}
    </div>
  );
}
