import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getTest, submitTest, gradeTest } from '../utils/googleSheets';
import {
  Loader2, AlertTriangle, CheckCircle, Shield, Timer,
  Mic, Volume2, Square, ChevronRight, ChevronLeft, Send,
  Wifi, WifiOff, MicOff
} from 'lucide-react';
import SystemCheck from '../components/SystemCheck';

/* ── Waveform animation when mic is active ── */
function WaveBar({ delay }) {
  return (
    <div
      className="w-1 bg-white rounded-full animate-wave"
      style={{
        animationDelay: delay,
        height: '100%',
      }}
    />
  );
}

export default function TestPage() {
  const { id } = useParams();
  const [questions, setQuestions] = useState([]);
  const [correctAnswers, setCorrectAnswers] = useState([]);
  const [topics, setTopics] = useState([]);
  const [difficulty, setDifficulty] = useState([]);
  const [answers, setAnswers] = useState({});
  const [status, setStatus] = useState('loading');
  const [tabSwitches, setTabSwitches] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [timeLeft, setTimeLeft] = useState(null);

  const [systemCheckPassed, setSystemCheckPassed] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [interimText, setInterimText] = useState('');

  const recognitionRef = useRef(null);
  const autoStopRef = useRef(null);
  const [browserSupported, setBrowserSupported] = useState(true);

  // ── Browser compatibility check ──
  useEffect(() => {
    const hasSpeechRecognition = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const hasTTS = !!window.speechSynthesis;
    if (!hasSpeechRecognition || !hasTTS) {
      setBrowserSupported(false);
    }
  }, []);

  // ── Load test data ──
  useEffect(() => {
    const fetchTestData = async () => {
      try {
        const data = await getTest(id);
        const parse = (v) => {
          if (!v) return [];
          try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return []; }
        };
        const q = parse(data?.questions);
        if (!q || q.length === 0) {
          setStatus('error');
          setErrorMessage('Test not found. Please check your link.');
          return;
        }
        // Block re-submission of already completed tests
        if (data?.status === 'Completed') {
          setStatus('already_done');
          return;
        }
        setQuestions(q);
        setCorrectAnswers(parse(data?.answers));
        setTopics(parse(data?.topics));
        setDifficulty(parse(data?.difficulty));
        setTimeLeft(Number(data?.timeLimit || 15) * 60);
        setStatus('ready');
      } catch {
        setStatus('error');
        setErrorMessage('Could not load your test. Please try again later.');
      }
    };
    fetchTestData();
  }, [id]);

  // ── Tab-switch protection ──
  useEffect(() => {
    if (!systemCheckPassed) return;
    const onVisibilityChange = () => { if (document.hidden) setTabSwitches(p => p + 1); };
    const block = (e) => e.preventDefault();
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('contextmenu', block);
    document.addEventListener('copy', block);
    document.addEventListener('cut', block);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('contextmenu', block);
      document.removeEventListener('copy', block);
      document.removeEventListener('cut', block);
    };
  }, [systemCheckPassed]);

  // ── Timer ──
  useEffect(() => {
    if (status !== 'ready' || timeLeft === null || !systemCheckPassed) return;
    if (timeLeft <= 0) { handleSubmit(null, true); return; }
    const timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [status, timeLeft, systemCheckPassed]);

  // ── Speech Recognition setup ──
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalAccumulator = '';

    recognition.onstart = () => {
      finalAccumulator = answers[currentQuestionIndex] || '';
    };

    recognition.onresult = (event) => {
      let interim = '';
      let newFinal = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          newFinal += event.results[i][0].transcript + ' ';
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (newFinal) {
        finalAccumulator += newFinal;
        setAnswers(prev => ({ ...prev, [currentQuestionIndex]: finalAccumulator.trim() }));
      }
      setInterimText(interim);

      // Auto-stop after 3s of silence via re-triggering
      clearTimeout(autoStopRef.current);
      autoStopRef.current = setTimeout(() => {
        // just keep going — user can manually stop
      }, 3000);
    };

    recognition.onend = () => {
      setIsRecording(false);
      setInterimText('');
    };

    recognition.onerror = () => {
      setIsRecording(false);
      setInterimText('');
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
      clearTimeout(autoStopRef.current);
      window.speechSynthesis.cancel();
    };
  }, [currentQuestionIndex]);

  // ── AI reads question aloud when ready ──
  useEffect(() => {
    if (systemCheckPassed && status === 'ready' && questions.length > 0) {
      speakQuestion(questions[currentQuestionIndex]);
    }
  }, [systemCheckPassed, currentQuestionIndex, status, questions]);

  const speakQuestion = (text) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.name.includes('Google') && v.lang.startsWith('en'))
      || voices.find(v => v.lang.startsWith('en'));
    if (preferred) utterance.voice = preferred;
    utterance.rate = 0.92;
    utterance.pitch = 1.05;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const toggleRecording = () => {
    if (!recognitionRef.current) return;
    if (isRecording) {
      recognitionRef.current.stop();
    } else {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      try {
        recognitionRef.current.start();
        setIsRecording(true);
      } catch {}
    }
  };

  const formatTime = (seconds) => {
    if (seconds <= 0) return '00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleNext = () => {
    if (isRecording) { recognitionRef.current?.stop(); setIsRecording(false); }
    if (currentQuestionIndex < questions.length - 1) setCurrentQuestionIndex(p => p + 1);
  };

  const handlePrev = () => {
    if (isRecording) { recognitionRef.current?.stop(); setIsRecording(false); }
    if (currentQuestionIndex > 0) setCurrentQuestionIndex(p => p - 1);
  };

  const handleSubmit = async (e, autoSubmit = false) => {
    if (e?.preventDefault) e.preventDefault();
    if (isRecording) { recognitionRef.current?.stop(); setIsRecording(false); }
    window.speechSynthesis.cancel();

    const answeredCount = Object.values(answers).filter(a => a?.trim().length > 0).length;
    if (!autoSubmit && answeredCount < questions.length) {
      if (!window.confirm(`You have answered ${answeredCount} of ${questions.length} questions. Submit anyway?`)) return;
    }

    try {
      setStatus('grading');
      const candidateAnswersList = questions.map((_, i) => answers[i] || '');
      const gradeResult = await gradeTest(questions, correctAnswers, topics, candidateAnswersList);
      setStatus('submitting');
      await submitTest({
        id,
        candidateAnswers: JSON.stringify(candidateAnswersList),
        score: gradeResult.overall_score ?? gradeResult.score ?? 0,
        perQuestionScores: JSON.stringify(gradeResult.per_question_scores || []),
        tabSwitches,
        status: 'Completed'
      });
      setStatus('success');
    } catch {
      setErrorMessage('Failed to submit. Please try again.');
      setStatus('error');
    }
  };

  const diffColor = { medium: 'text-blue-400', hard: 'text-orange-400', very_hard: 'text-red-400' };
  const diffLabel = { medium: 'Medium', hard: 'Hard', very_hard: 'Very Hard' };

  // ── Loading ──
  if (status === 'loading') return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col items-center justify-center gap-5">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-500 animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-5 h-5 bg-indigo-500 rounded-full animate-pulse" />
        </div>
      </div>
      <p className="text-slate-400 font-medium tracking-wide">Loading your interview...</p>
    </div>
  );

  // ── Success ──
  if (status === 'success') return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="relative max-w-md w-full">
        <div className="absolute inset-0 bg-emerald-500/10 rounded-3xl blur-xl" />
        <div className="relative bg-[#1a1d2e] border border-emerald-500/20 p-10 rounded-3xl text-center space-y-5">
          <div className="w-20 h-20 bg-emerald-500/15 rounded-full flex items-center justify-center mx-auto ring-4 ring-emerald-500/10">
            <CheckCircle className="w-10 h-10 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Interview Completed!</h2>
            <p className="text-slate-400 text-sm mt-2">Your responses have been recorded and are being reviewed by the HR team.</p>
          </div>
          <div className="bg-[#0f1117] rounded-2xl p-4 text-xs text-slate-500">
            You may now safely close this window.
          </div>
        </div>
      </div>
    </div>
  );

  // ── Already Completed ──
  if (status === 'already_done') return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="relative max-w-md w-full">
        <div className="absolute inset-0 bg-amber-500/8 rounded-3xl blur-xl" />
        <div className="relative bg-[#1a1d2e] border border-amber-500/20 p-10 rounded-3xl text-center space-y-4">
          <div className="w-16 h-16 bg-amber-500/15 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle className="w-8 h-8 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Already Submitted</h2>
          <p className="text-slate-400 text-sm">This interview has already been completed. Each assessment link can only be used once.</p>
          <p className="text-slate-600 text-xs">If you think this is an error, please contact your HR team.</p>
        </div>
      </div>
    </div>
  );

  // ── Browser Not Supported ──
  if (!browserSupported) return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="bg-[#1a1d2e] border border-orange-500/20 p-8 rounded-3xl max-w-md w-full text-center space-y-4">
        <div className="text-4xl">🌐</div>
        <h2 className="text-xl font-bold text-white">Unsupported Browser</h2>
        <p className="text-slate-400 text-sm">This AI Interview requires voice features that are not supported in your browser.</p>
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 text-left">
          <p className="text-orange-300 text-xs font-semibold mb-2">Please use one of these browsers:</p>
          <ul className="text-slate-400 text-xs space-y-1">
            <li>✅ Google Chrome (recommended)</li>
            <li>✅ Microsoft Edge</li>
            <li>✅ Safari (macOS / iOS)</li>
            <li>❌ Firefox (not supported)</li>
          </ul>
        </div>
      </div>
    </div>
  );

  // ── Error ──
  if (status === 'error' && !questions.length) return (
    <div className="min-h-screen bg-[#0f1117] flex items-center justify-center p-4">
      <div className="bg-[#1a1d2e] border border-red-500/20 p-8 rounded-3xl max-w-md w-full text-center">
        <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white">Oops!</h2>
        <p className="text-slate-400 text-sm mt-2">{errorMessage}</p>
      </div>
    </div>
  );

  // ── Grading / Submitting ──
  if (status === 'grading' || status === 'submitting') return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col items-center justify-center gap-6">
      <div className="relative w-20 h-20">
        <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-500 animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-white font-semibold text-lg">
          {status === 'grading' ? '🤖 AI is evaluating your answers...' : '📤 Submitting results...'}
        </p>
        <p className="text-slate-500 text-sm mt-2">Please don't close this window.</p>
      </div>
    </div>
  );

  // ── System Check ──
  if (status === 'ready' && !systemCheckPassed) {
    return <SystemCheck onComplete={() => setSystemCheckPassed(true)} />;
  }

  const isLastQuestion = currentQuestionIndex === questions.length - 1;
  const currentAnswer = answers[currentQuestionIndex] || '';
  const currentTopic = topics[currentQuestionIndex];
  const currentDiff = difficulty[currentQuestionIndex];
  const answeredCount = Object.values(answers).filter(a => a?.trim().length > 0).length;
  const isTimeLow = timeLeft !== null && timeLeft < 60;

  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col">

      {/* ── Top Bar ── */}
      <header className="border-b border-white/5 bg-[#0f1117]/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-900">
              <span className="text-white font-black text-sm">H</span>
            </div>
            <span className="font-bold text-white text-sm hidden sm:block">AI Interview</span>
          </div>

          {/* Center: Progress dots */}
          <div className="flex items-center gap-1 flex-wrap justify-center max-w-[160px] sm:max-w-xs">
            {questions.map((_, idx) => (
              <button
                key={idx}
                onClick={() => {
                  if (isRecording) { recognitionRef.current?.stop(); setIsRecording(false); }
                  setCurrentQuestionIndex(idx);
                }}
                className={`transition-all rounded-full ${
                  idx === currentQuestionIndex
                    ? 'w-5 h-2 bg-indigo-500'
                    : answers[idx]?.trim()
                    ? 'w-2 h-2 bg-emerald-500'
                    : 'w-2 h-2 bg-white/15 hover:bg-white/30'
                }`}
              />
            ))}
          </div>

          {/* Right: Timer + Shield */}
          <div className="flex items-center gap-2">
            {timeLeft !== null && (
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${
                isTimeLow
                  ? 'bg-red-500/15 text-red-400 border border-red-500/30 animate-pulse'
                  : 'bg-white/5 text-slate-300 border border-white/10'
              }`}>
                <Timer className="w-3.5 h-3.5" />
                {formatTime(timeLeft)}
              </div>
            )}
            <div className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-slate-400 text-xs hidden sm:flex">
              <Shield className="w-3 h-3" />
              <span>Monitored</span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Tab-switch Warning ── */}
      {tabSwitches > 0 && (
        <div className="bg-red-600/90 backdrop-blur">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <p className="text-sm font-semibold text-white">
              ⚠ Tab switch detected — {tabSwitches} time{tabSwitches > 1 ? 's' : ''}. Recorded for HR.
            </p>
          </div>
        </div>
      )}

      {/* ── Main Content ── */}
      <main className="flex-1 flex flex-col items-center px-3 sm:px-6 py-6 sm:py-8 max-w-3xl mx-auto w-full">

        {/* Question Counter */}
        <div className="w-full flex items-center justify-between mb-4">
          <span className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">
            Question {currentQuestionIndex + 1} / {questions.length}
          </span>
          <span className="text-xs text-slate-500">
            {answeredCount} of {questions.length} answered
          </span>
        </div>

        {/* ── Question Card ── */}
        <div className="w-full rounded-2xl sm:rounded-3xl border border-white/8 bg-gradient-to-b from-[#1a1d2e] to-[#161926] shadow-2xl shadow-black/40 overflow-hidden mb-5 sm:mb-6">

          {/* Question Header */}
          <div className="px-4 sm:px-6 pt-5 sm:pt-6 pb-4 border-b border-white/5">
            <div className="flex items-start gap-3">
              {/* Replay TTS Button */}
              <button
                onClick={() => speakQuestion(questions[currentQuestionIndex])}
                title="Replay question audio"
                className={`shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl flex items-center justify-center transition-all ${
                  isSpeaking
                    ? 'bg-indigo-600 shadow-lg shadow-indigo-900/60'
                    : 'bg-white/5 hover:bg-indigo-600/20 border border-white/10'
                }`}
              >
                <Volume2 className={`w-4 h-4 sm:w-5 sm:h-5 ${isSpeaking ? 'text-white animate-pulse' : 'text-slate-400'}`} />
              </button>

              <div className="flex-1 min-w-0">
                {/* Tags */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {currentTopic && (
                    <span className="text-[10px] px-2 py-0.5 bg-indigo-500/10 text-indigo-400 rounded-full border border-indigo-500/20 font-medium uppercase tracking-wider">
                      {currentTopic}
                    </span>
                  )}
                  {currentDiff && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase tracking-wider ${
                      currentDiff === 'medium' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                      currentDiff === 'hard' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' :
                      'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                      {diffLabel[currentDiff] || currentDiff}
                    </span>
                  )}
                </div>
                {/* Question Text */}
                <p className="text-white font-semibold text-base sm:text-lg leading-relaxed">
                  {questions[currentQuestionIndex]}
                </p>
              </div>
            </div>
          </div>

          {/* Answer Display */}
          <div className="px-4 sm:px-6 py-4 sm:py-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Your Answer</span>
              {currentAnswer && (
                <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Recorded
                </span>
              )}
            </div>

            {/* Answer Box - read-only display */}
            <div className={`relative min-h-[140px] rounded-2xl border p-4 transition-all ${
              isRecording
                ? 'border-red-500/40 bg-red-500/5'
                : currentAnswer
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-white/8 bg-white/3'
            }`}>
              {isRecording && interimText && (
                <p className="text-slate-400 italic text-sm leading-relaxed">
                  {currentAnswer && <span className="text-slate-300 not-italic">{currentAnswer} </span>}
                  {interimText}
                  <span className="animate-pulse ml-1 text-red-400">|</span>
                </p>
              )}
              {!isRecording && currentAnswer && (
                <p className="text-slate-200 text-sm leading-relaxed whitespace-pre-wrap">{currentAnswer}</p>
              )}
              {!isRecording && !currentAnswer && (
                <div className="flex flex-col items-center justify-center h-full min-h-[100px] text-center gap-2">
                  <MicOff className="w-8 h-8 text-slate-600" />
                  <p className="text-slate-600 text-sm">Click the microphone below to speak your answer</p>
                </div>
              )}
              {isRecording && !interimText && !currentAnswer && (
                <div className="flex flex-col items-center justify-center h-full min-h-[100px] text-center gap-2">
                  <p className="text-red-400 text-sm font-medium animate-pulse">🎙 Listening... speak now</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Microphone Button ── */}
        <div className="flex flex-col items-center gap-3 mb-6 sm:mb-8">
          <button
            onClick={toggleRecording}
            className={`relative w-18 h-18 sm:w-20 sm:h-20 rounded-full flex items-center justify-center transition-all duration-300 shadow-2xl active:scale-95 ${
              isRecording
                ? 'bg-red-500 shadow-red-900/60 scale-110'
                : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-900/60 hover:scale-105'
            }`}
            style={{ width: '72px', height: '72px' }}
          >
            {/* Pulse rings when recording */}
            {isRecording && (
              <>
                <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-30" />
                <span className="absolute inset-[-8px] rounded-full border border-red-500/30 animate-ping opacity-20" />
              </>
            )}
            {isRecording ? (
              <div className="flex items-end gap-0.5 h-7 px-1">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1.5 bg-white rounded-full animate-bounce"
                    style={{
                      animationDelay: `${i * 0.1}s`,
                      animationDuration: '0.6s',
                      height: `${40 + Math.sin(i * 1.5) * 30}%`
                    }}
                  />
                ))}
              </div>
            ) : (
              <Mic className="w-8 h-8 text-white" />
            )}
          </button>
          <p className={`text-xs font-semibold transition-colors ${isRecording ? 'text-red-400' : 'text-slate-500'}`}>
            {isRecording ? 'Tap to stop recording' : 'Tap to speak your answer'}
          </p>
        </div>

        {/* ── Navigation ── */}
        <div className="w-full flex items-center justify-between gap-4">
          <button
            onClick={handlePrev}
            disabled={currentQuestionIndex === 0}
            className="flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-20 disabled:hover:bg-transparent transition-all border border-white/5 hover:border-white/10"
          >
            <ChevronLeft className="w-4 h-4" /> Previous
          </button>

          {isLastQuestion ? (
            <button
              onClick={handleSubmit}
              className="flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-900/50 transition-all hover:scale-105"
            >
              <Send className="w-4 h-4" /> Submit Interview
            </button>
          ) : (
            <button
              onClick={handleNext}
              className="flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-900/40 transition-all hover:scale-105"
            >
              Next Question <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {status === 'error' && (
          <div className="mt-4 w-full text-red-400 text-sm bg-red-500/10 border border-red-500/20 p-4 rounded-xl">
            {errorMessage}
          </div>
        )}
      </main>

      <style>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(0.3); }
          50% { transform: scaleY(1); }
        }
        .animate-wave {
          animation: wave 0.8s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
