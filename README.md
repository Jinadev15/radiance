# Attendance Management System Using Face Recognition

An automated attendance management system that leverages facial recognition technology to streamline attendance tracking for educational institutions. This full-stack application allows teachers to manage students and classes, capture facial data, and monitor attendance in real-time through AI-powered face recognition.

## Features

- **User Authentication**: Secure login system for teachers using JWT tokens
- **Student Management**: Add, view, and manage student information
- **Class Management**: Create and organize classes
- **Face Recognition**: Capture and store facial embeddings for accurate identification
- **Real-time Attendance Monitoring**: Automated attendance marking using live face recognition
- **Dashboard Analytics**: View attendance reports and statistics
- **Responsive UI**: Modern, intuitive interface built with React and Next.js
- **RESTful API**: Well-structured backend API for all operations

## Tech Stack

### Backend

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **MongoDB** - NoSQL database
- **Mongoose** - ODM for MongoDB
- **JWT** - Authentication
- **bcryptjs** - Password hashing

### Frontend

- **Next.js** - React framework
- **React** - UI library
- **TypeScript** - Type-safe JavaScript
- **Tailwind CSS** - Utility-first CSS framework
- **Radix UI** - Accessible UI components
- **React Hook Form** - Form handling
- **Zod** - Schema validation

### Machine Learning Service

- **Python** - Programming language
- **FastAPI** - Modern web framework
- **DeepFace** - Face recognition library
- **OpenCV** - Computer vision library
- **TensorFlow** - Machine learning framework
- **MTCNN** - Face detection
- **scikit-learn** - Machine learning algorithms

## Architecture & How It Works

The system consists of three main components:

1. **Frontend (Next.js)**: Provides the user interface for teachers to interact with the system
2. **Backend (Node.js/Express)**: Handles business logic, database operations, and API endpoints
3. **ML Service (Python/FastAPI)**: Processes facial recognition tasks

### Workflow:

1. **Setup**: Teachers register/login and create classes/students
2. **Face Enrollment**: Capture multiple face images of students to generate facial embeddings
3. **Attendance Monitoring**: Use camera feed to detect and recognize faces in real-time
4. **Automated Marking**: System automatically marks attendance based on recognized faces
5. **Reports**: View attendance statistics and generate reports

## Prerequisites

Before running this application, make sure you have the following installed:

- **Node.js** (v16 or higher)
- **Python** (v3.8 or higher)
- **MongoDB** (local installation or cloud instance like MongoDB Atlas)
- **npm** or **yarn** package manager
- **pip** Python package manager

## Installation

1. **Clone the repository:**

   ```bash
   git clone <repository-url>
   cd attendance-management-system-using-face-recognition
   ```

2. **Backend Setup:**

   ```bash
   cd backend
   npm install
   ```

3. **Frontend Setup:**

   ```bash
   cd ../frontend
   npm install
   ```

4. **ML Service Setup:**
   ```bash
   cd ../ml-service
   pip install -r requirements.txt
   ```

## Environment Configuration

1. **Backend Environment Variables:**
   Create a `.env` file in the `backend` directory:

   ```
   PORT=5000
   MONGODB_URI=mongodb://localhost:27017/attendance-system
   JWT_SECRET=your-jwt-secret-key
   ```

2. **Frontend Environment Variables:**
   Create a `.env.local` file in the `frontend` directory:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:5000/api
   ```

## Running the Application

1. **Start MongoDB:**
   Make sure MongoDB is running on your system.

2. **Start the ML Service:**

   ```bash
   cd ml-service
   python main.py
   ```

   The service will run on `http://localhost:8000`

3. **Start the Backend:**

   ```bash
   cd backend
   npm run dev
   ```

   The backend will run on `http://localhost:5000`

4. **Start the Frontend:**
   ```bash
   cd frontend
   npm run dev
   ```
   The frontend will run on `http://localhost:3000`

## Usage

1. **Access the Application:**
   Open your browser and navigate to `http://localhost:3000`

2. **Teacher Registration/Login:**

   - Register as a teacher or login with existing credentials

3. **Setup Classes:**

   - Create classes and add students to each class

4. **Student Face Enrollment:**

   - For each student, capture multiple face images to build facial recognition data

5. **Attendance Monitoring:**

   - Start the attendance session for a class
   - The system will use the camera to detect and recognize student faces
   - Attendance is automatically marked for recognized students

6. **View Reports:**
   - Access the dashboard to view attendance statistics and generate reports

## API Endpoints

### Authentication

- `POST /api/auth/login` - Teacher login
- `POST /api/auth/register` - Teacher registration

### Students

- `GET /api/students` - Get all students
- `POST /api/students` - Add new student
- `PUT /api/students/:id` - Update student
- `DELETE /api/students/:id` - Delete student

### Classes

- `GET /api/classes` - Get all classes
- `POST /api/classes` - Create new class
- `PUT /api/classes/:id` - Update class
- `DELETE /api/classes/:id` - Delete class

### Attendance

- `GET /api/attendance` - Get attendance records
- `POST /api/attendance` - Mark attendance
- `GET /api/attendance/reports` - Get attendance reports

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License - see the LICENSE file for details.

## Acknowledgments

- DeepFace library for facial recognition capabilities
- Radix UI for accessible component primitives
- Next.js team for the excellent React framework
- FastAPI for the Python web framework

## Support

For support, email support@example.com or create an issue in the repository.
