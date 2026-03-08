import { useState, useEffect, useCallback, useRef } from "react";
import { Camera, Zap, Terminal, Moon, Sun } from "lucide-react";
import {
  Badge,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../components/ui";
import { useTheme } from "../../App";
import { PhotoStream, type Photo } from "./components/PhotoStream";
import { AudioControls } from "./components/AudioControls";
import {
  TranscriptionFeed,
  type Transcription,
} from "./components/TranscriptionFeed";
import { SystemLogs, type Log } from "./components/SystemLogs";

interface HomePageProps {
  userId: string;
}

const FRAME_INTERVAL_MS = 1000;

export default function HomePage({ userId }: HomePageProps) {
  const { isDarkMode, toggleTheme } = useTheme();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const logIdCounter = useRef(Date.now());
  const transcriptionIdCounter = useRef(Date.now());

  const addLog = useCallback((message: string) => {
    setLogs((prev) =>
      [
        {
          id: logIdCounter.current++,
          message,
          time: new Date().toLocaleTimeString(),
        },
        ...prev,
      ].slice(0, 20),
    );
  }, []);

  const addPhoto = useCallback(
    (payload: {
      requestId?: string;
      dataUrl?: string;
      imageDataUrl?: string;
      timestamp?: string | number;
    }) => {
      const dataUrl = payload.dataUrl || payload.imageDataUrl;
      if (!payload.requestId || !dataUrl) return;

      setPhotos((prev) => {
        if (prev.some((p) => p.requestId === payload.requestId)) return prev;
        const timestamp = payload.timestamp || Date.now();
        addLog(`Photo captured at ${new Date(timestamp).toLocaleTimeString()}`);

        return [
          {
            id: payload.requestId,
            requestId: payload.requestId,
            url: dataUrl,
            timestamp: new Date(timestamp).toLocaleTimeString(),
          },
          ...prev,
        ].slice(0, 6);
      });
    },
    [addLog],
  );

  const addTranscription = useCallback((payload: {
    text?: string;
    timestamp?: string | number;
    isFinal?: boolean;
  }) => {
    if (!payload.text) return;

    setTranscriptions((prev) => {
      const entry = {
        id: transcriptionIdCounter.current++,
        text: payload.text,
        time: new Date(payload.timestamp || Date.now()).toLocaleTimeString(),
        isFinal: Boolean(payload.isFinal),
      };

      if (entry.isFinal) {
        if (prev.length > 0 && !prev[0].isFinal) {
          const updated = [...prev];
          updated[0] = { ...updated[0], ...entry, id: updated[0].id };
          return updated.slice(0, 10);
        }
        return [entry, ...prev].slice(0, 10);
      }

      if (prev.length === 0 || prev[0].isFinal) {
        return [entry, ...prev].slice(0, 10);
      }

      const updated = [...prev];
      updated[0] = { ...updated[0], ...entry, id: updated[0].id };
      return updated;
    });
  }, []);

  // Connect to remote websocket and start frame uploads when connected
  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let frameInterval: ReturnType<typeof setInterval> | null = null;
    let isCapturingFrame = false;

    const stopFrameStreaming = () => {
      if (frameInterval) {
        clearInterval(frameInterval);
        frameInterval = null;
      }
    };

    const startFrameStreaming = () => {
      stopFrameStreaming();

      const streamFrame = async () => {
        if (!socket || socket.readyState !== WebSocket.OPEN || isCapturingFrame) {
          return;
        }

        isCapturingFrame = true;

        try {
          const response = await fetch("/api/capture-photo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const errorMessage =
              typeof errorData.error === "string"
                ? errorData.error
                : `HTTP ${response.status}`;
            addLog(`Frame capture failed: ${errorMessage}`);
            return;
          }

          const frame = await response.json();
          if (!frame?.requestId || !frame?.imageDataUrl) {
            addLog("Frame capture failed: invalid payload from /api/capture-photo");
            return;
          }

          addPhoto(frame);

          socket.send(
            JSON.stringify({
              type: "photo-frame",
              userId,
              requestId: frame.requestId,
              timestamp: frame.timestamp,
              imageDataUrl: frame.imageDataUrl,
            }),
          );
        } catch (error) {
          addLog(`Frame capture failed: ${String(error)}`);
        } finally {
          isCapturingFrame = false;
        }
      };

      streamFrame();
      frameInterval = setInterval(streamFrame, FRAME_INTERVAL_MS);
      addLog("Started camera frame streaming to websocket");
    };

    const connect = () => {
      socket = new WebSocket(
        `wss://allen.hardmode.ngrok.app?userId=${encodeURIComponent(userId)}`,
      );

      socket.onopen = () => {
        addLog("Connected to websocket stream");
        startFrameStreaming();
      };

      socket.onmessage = (event) => {
        try {
          if (typeof event.data !== "string") return;

          const data = JSON.parse(event.data);
          const eventType = String(data.type || data.event || "").toLowerCase();

          if (eventType.includes("transcription") || data.text) {
            addTranscription(data);
            return;
          }

          if (eventType.includes("log") && data.message) {
            addLog(String(data.message));
            return;
          }

          if (eventType === "ack" && data.requestId) {
            addLog(`Frame uploaded: ${data.requestId}`);
          }
        } catch {
          addLog("Received non-JSON websocket payload");
        }
      };

      socket.onclose = () => {
        stopFrameStreaming();
        addLog("Websocket disconnected, reconnecting...");
        reconnectTimeout = setTimeout(connect, 3000);
      };

      socket.onerror = () => {
        addLog("Websocket connection error");
      };
    };

    connect();

    return () => {
      stopFrameStreaming();
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      socket?.close();
    };
  }, [addLog, addPhoto, addTranscription, userId]);

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <Camera className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Camera App</h1>
            <p className="text-xs text-muted-foreground">MentraOS</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant="outline" className="font-mono text-xs">
            {userId?.substring(0, 8)}...
          </Badge>
          <div className="flex items-center gap-2">
            <Sun className="w-3.5 h-3.5 text-muted-foreground" />
            <Switch checked={isDarkMode} onCheckedChange={toggleTheme} />
            <Moon className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
        </div>
      </div>

      {/* Photo Stream */}
      <PhotoStream photos={photos} />

      {/* Audio Controls */}
      <AudioControls userId={userId} onLog={addLog} />

      {/* Transcriptions & Logs */}
      <Tabs defaultValue="transcriptions">
        <TabsList className="w-full">
          <TabsTrigger value="transcriptions" className="flex-1">
            <Zap className="w-3.5 h-3.5" />
            Transcriptions
          </TabsTrigger>
          <TabsTrigger value="logs" className="flex-1">
            <Terminal className="w-3.5 h-3.5" />
            System Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transcriptions">
          <TranscriptionFeed transcriptions={transcriptions} />
        </TabsContent>

        <TabsContent value="logs">
          <SystemLogs logs={logs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
