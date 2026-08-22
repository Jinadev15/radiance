import React, { useState, useEffect } from 'react';
import LandingScreen from './components/LandingScreen';
import ActionChoice from './components/ActionChoice';
import RegistrationForm from './components/RegistrationForm';
import ReportIssueForm from './components/ReportIssueForm';
import FaceCapture from './components/FaceCapture';
import ProcessingScreen from './components/ProcessingScreen';
import ResultScreen from './components/ResultScreen';
import MyAttendanceScreen from './components/MyAttendanceScreen';
import { clockIn, clockOut, registerEmployee, fetchMyAttendance, reportIssue } from './utils/api';
import { startAutoSync } from './utils/offlineQueue';

const STATES = {
  LANDING: 'LANDING',
  ACTION_CHOICE: 'ACTION_CHOICE',
  REGISTRATION: 'REGISTRATION',
  REPORT_ISSUE: 'REPORT_ISSUE',
  FACE_CAPTURE: 'FACE_CAPTURE',
  PROCESSING: 'PROCESSING',
  RESULT: 'RESULT',
  MY_ATTENDANCE_RESULT: 'MY_ATTENDANCE_RESULT',
};

function App() {
  const [currentScreen, setCurrentScreen] = useState(STATES.LANDING);
  const [userType, setUserType] = useState(null); // 'existing' | 'new'
  const [actionType, setActionType] = useState(null); // 'clock-in' | 'clock-out' | 'register' | 'my-attendance' | 'report-issue'

  const [registrationData, setRegistrationData] = useState(null);
  const [issueReport, setIssueReport] = useState(null);

  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Retries any queued offline scans in the background for the lifetime of the app.
  useEffect(() => {
    const intervalId = startAutoSync();
    return () => clearInterval(intervalId);
  }, []);

  // Transition handlers
  const handleExistingUser = () => {
    setUserType('existing');
    setCurrentScreen(STATES.ACTION_CHOICE);
  };

  const handleNewUser = () => {
    setUserType('new');
    setActionType('register');
    setCurrentScreen(STATES.REGISTRATION);
  };

  const handleActionChoice = (action) => {
    setActionType(action);
    if (action === 'report-issue') {
      setCurrentScreen(STATES.REPORT_ISSUE);
    } else {
      setCurrentScreen(STATES.FACE_CAPTURE);
    }
  };

  const handleRegistrationSubmit = (data) => {
    setRegistrationData(data);
    setCurrentScreen(STATES.FACE_CAPTURE);
  };

  const handleReportIssueSubmit = (data) => {
    setIssueReport(data);
    setCurrentScreen(STATES.FACE_CAPTURE);
  };

  const handleFaceCapture = async (images, location) => {
    setCurrentScreen(STATES.PROCESSING);
    const isMyAttendance = actionType === 'my-attendance';

    try {
      let resData;
      if (actionType === 'clock-in') {
        resData = await clockIn(images, location?.latitude, location?.longitude);
      } else if (actionType === 'clock-out') {
        resData = await clockOut(images, location?.latitude, location?.longitude);
      } else if (actionType === 'register') {
        resData = await registerEmployee(
          registrationData.name,
          registrationData.phone,
          registrationData.aadhaar,
          registrationData.dob,
          images[0],
          { consent: registrationData.consent }
        );
      } else if (isMyAttendance) {
        resData = await fetchMyAttendance(images);
      } else if (actionType === 'report-issue') {
        resData = await reportIssue(images, issueReport.date, issueReport.reason);
      }

      if (isMyAttendance) {
        setResult(resData);
        setError(null);
      } else {
        setResult({ success: true, data: resData });
        setError(null);
      }
    } catch (err) {
      setResult(isMyAttendance ? null : { success: false, data: null });
      setError(err.message || 'An unknown error occurred');
    } finally {
      setCurrentScreen(isMyAttendance ? STATES.MY_ATTENDANCE_RESULT : STATES.RESULT);
    }
  };

  const handleReset = () => {
    setUserType(null);
    setActionType(null);
    setRegistrationData(null);
    setIssueReport(null);
    setResult(null);
    setError(null);
    setCurrentScreen(STATES.LANDING);
  };

  const faceCaptureBack = () => {
    if (actionType === 'register') return setCurrentScreen(STATES.REGISTRATION);
    if (actionType === 'report-issue') return setCurrentScreen(STATES.REPORT_ISSUE);
    return setCurrentScreen(STATES.ACTION_CHOICE);
  };

  return (
    <div className="app-container">
      {currentScreen === STATES.LANDING && (
        <LandingScreen
          onExistingUser={handleExistingUser}
          onNewUser={handleNewUser}
        />
      )}

      {currentScreen === STATES.ACTION_CHOICE && (
        <ActionChoice
          onChoice={handleActionChoice}
          onBack={handleReset}
        />
      )}

      {currentScreen === STATES.REGISTRATION && (
        <RegistrationForm
          onSubmit={handleRegistrationSubmit}
          onBack={handleReset}
        />
      )}

      {currentScreen === STATES.REPORT_ISSUE && (
        <ReportIssueForm
          onSubmit={handleReportIssueSubmit}
          onBack={() => setCurrentScreen(STATES.ACTION_CHOICE)}
        />
      )}

      {currentScreen === STATES.FACE_CAPTURE && (
        <FaceCapture
          onCapture={handleFaceCapture}
          onBack={faceCaptureBack}
        />
      )}

      {currentScreen === STATES.PROCESSING && (
        <ProcessingScreen />
      )}

      {currentScreen === STATES.RESULT && (
        <ResultScreen
          result={result}
          error={error}
          actionType={actionType}
          onReset={handleReset}
        />
      )}

      {currentScreen === STATES.MY_ATTENDANCE_RESULT && (
        <MyAttendanceScreen
          result={result}
          error={error}
          onReset={handleReset}
        />
      )}
    </div>
  );
}

export default App;
