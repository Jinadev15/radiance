"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Camera, X, Download } from "lucide-react"

interface CaptureImageModalProps {
  open: boolean
  onClose: () => void
  onCapture: (images: string[]) => void
}

export default function CaptureImageModal({ open, onClose, onCapture }: CaptureImageModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [images, setImages] = useState<string[]>([])
  const [isCapturing, setIsCapturing] = useState(false)
  const [streamActive, setStreamActive] = useState(false)

  useEffect(() => {
    if (!open) return

    const startCamera = async () => {
      try {
        // Check if mediaDevices API is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          console.error("Camera API not supported in this browser")
          alert("Camera access is not supported in this browser. Please use a modern browser like Chrome, Firefox, or Edge.")
          onClose()
          return
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false,
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          setStreamActive(true)
        }
      } catch (error) {
        console.error("Error accessing camera:", error)
        alert("Unable to access camera. Please ensure you have granted camera permissions and are using HTTPS or localhost.")
        onClose()
      }
    }

    startCamera()

    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks()
        tracks.forEach((track) => track.stop())
        setStreamActive(false)
      }
    }
  }, [open, onClose])

  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext("2d")
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth
        canvasRef.current.height = videoRef.current.videoHeight
        context.drawImage(videoRef.current, 0, 0)
        const imageData = canvasRef.current.toDataURL("image/jpeg")
        setImages((prev) => [...prev, imageData])

        // Auto-capture multiple images (up to 20)
        if (images.length < 19) {
          setIsCapturing(true)
        }
      }
    }
  }

  useEffect(() => {
    if (isCapturing && images.length < 20) {
      const timer = setTimeout(() => {
        captureImage()
      }, 300)
      return () => clearTimeout(timer)
    } else if (images.length >= 20) {
      setIsCapturing(false)
    }
  }, [isCapturing, images.length])

  const handleStartCapture = () => {
    setImages([])
    setIsCapturing(true)
    captureImage()
  }

  const handleFinish = () => {
    if (images.length > 0) {
      onCapture(images)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl bg-card border-border max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <CardTitle className="text-foreground">Capture Facial Images</CardTitle>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={24} />
          </button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Video Stream */}
          <div className="bg-background rounded-lg overflow-hidden border-2 border-border">
            <video ref={videoRef} autoPlay playsInline className="w-full aspect-video object-cover" />
          </div>

          {/* Canvas for capturing */}
          <canvas ref={canvasRef} className="hidden" />

          {/* Captured Count */}
          <div className="bg-muted rounded-lg p-4">
            <p className="text-sm text-muted-foreground">
              Captured: <span className="font-bold text-primary">{images.length}</span> / 20 images
            </p>
            <div className="w-full bg-input rounded-full h-2 mt-2">
              <div
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${(images.length / 20) * 100}%` }}
              />
            </div>
          </div>

          {/* Preview Thumbnails */}
          {images.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground mb-2">Preview ({images.length})</p>
              <div className="grid grid-cols-6 gap-2 max-h-32 overflow-y-auto">
                {images.map((img, idx) => (
                  <div key={idx} className="w-full aspect-square rounded-lg border-2 border-primary overflow-hidden">
                    <img
                      src={img || "/placeholder.svg"}
                      alt={`Capture ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pt-4">
            <Button onClick={onClose} variant="outline" className="flex-1 border-border bg-transparent">
              Cancel
            </Button>
            <Button
              onClick={handleStartCapture}
              disabled={isCapturing || images.length >= 20}
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Camera size={18} className="mr-2" />
              {isCapturing ? "Capturing..." : "Start Capture"}
            </Button>
            <Button
              onClick={handleFinish}
              disabled={images.length === 0}
              className="flex-1 bg-accent hover:bg-accent/90 text-accent-foreground"
            >
              <Download size={18} className="mr-2" />
              Finish ({images.length})
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
