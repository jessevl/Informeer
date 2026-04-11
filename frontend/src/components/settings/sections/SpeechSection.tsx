/**
 * Speech Section
 * Wrapper around the TTS settings panel
 */

import React from 'react';
import { TTSSettingsPanel } from '@/components/tts/TTSSettingsPanel';

const SpeechSection: React.FC = () => (
  <div className="space-y-4">
    <TTSSettingsPanel />
  </div>
);

export default SpeechSection;
