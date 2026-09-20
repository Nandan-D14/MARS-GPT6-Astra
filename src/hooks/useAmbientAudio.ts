import { useCallback, useEffect, useRef, useState } from 'react';

export function useAmbientAudio() {
  const [enabled, setEnabled] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const enabledRef = useRef(false);

  const toggle = useCallback(async () => {
    if (!contextRef.current) {
      const context = new AudioContext();
      contextRef.current = context;
      const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) {
        last = (last + Math.random() * 0.04 - 0.02) / 1.018;
        data[i] = last * 3.5;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 450;
      const gain = context.createGain();
      gain.gain.value = 0.2;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      source.start();
      sourceRef.current = source;
    }
    const next = !enabledRef.current;
    if (next) await contextRef.current.resume();
    else await contextRef.current.suspend();
    enabledRef.current = next;
    setEnabled(next);
    return next;
  }, []);

  useEffect(() => {
    const visibility = () => {
      if (!contextRef.current) return;
      if (document.hidden) void contextRef.current.suspend();
      else if (enabledRef.current) void contextRef.current.resume();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      sourceRef.current?.stop();
      void contextRef.current?.close();
    };
  }, []);

  return { enabled, toggle };
}