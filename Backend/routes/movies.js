const express = require('express');
const sql = require('mssql'); 
const { authenticateToken, jwt } = require('../middleware/authMiddleware'); 
const router = express.Router();
const { processMoviesWithDirectors } = require('../utils/processMovies'); 

// Search movies by title (Simple search)
router.get('/search/title/:string', async (req, res) => {
    const searchString = req.params.string;

    try {
        const query = `
            SELECT TOP 10 M.MovieID, M.Title, M.MoviePosterLink
            FROM Movies M
            WHERE LOWER(M.Title) LIKE LOWER(@searchString)
            ORDER BY M.ReleaseDate DESC;
        `;

        const request = new sql.Request();
        request.input('searchString', sql.VarChar, `%${searchString}%`); 

        const result = await request.query(query);

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'No movies found matching the title' });
        }

        const response = await processMoviesWithDirectors(result.recordset);
        res.json({ success: true, movies: response });
    } catch (error) {
        console.error('Error during movie search:', error.message);
        res.status(500).json({ success: false, message: 'Internal server error'});
    }
});

// Discover movie (Advanced search)
router.get('/discover', async (req, res) => {
    try {
        const {
            title,
            type, // 'Movie' or 'Series'
            genre, // string or array of genre names
            language,
            releaseYearFrom,
            releaseYearTo,
            imdbRatingMin,
            imdbRatingMax,
            fmdbRatingMin,
            fmdbRatingMax,
            director,
            actor,
            writer,
            keyword,
            movieLength
        } = req.query;

        let query = `
            SELECT DISTINCT M.MovieID, M.Title, M.MoviePosterLink
            FROM Movies M
            LEFT JOIN MovieGenres MG ON M.MovieID = MG.MovieID
            LEFT JOIN Genres G ON MG.GenreID = G.GenreID
            LEFT JOIN MovieDirectors MD ON M.MovieID = MD.MovieID
            LEFT JOIN Directors D ON MD.DirectorID = D.DirectorID
            LEFT JOIN MovieActors MA ON M.MovieID = MA.MovieID
            LEFT JOIN Actors A ON MA.ActorID = A.ActorID
            LEFT JOIN MovieKeywords MK ON M.MovieID = MK.MovieID
            LEFT JOIN Keywords K ON MK.KeywordID = K.KeywordID
            LEFT JOIN MovieWriters MW ON M.MovieID = MW.MovieID
            LEFT JOIN Writers W ON MW.WriterID = W.WriterID
            WHERE 1=1
        `;

        const request = new sql.Request();

        if (title) {
            query += ' AND M.Title LIKE @Title';
            request.input('Title', sql.VarChar, `%${title}%`);
        }

        if (type) {
            query += ' AND LOWER(M.Type) = LOWER(@Type)';
            request.input('Type', sql.VarChar, type);
        }

        if (genre) {
            query += ' AND LOWER(G.GenreName) IN (LOWER(@Genres))';
            request.input('Genres', sql.VarChar, genre);
        }

        if (language) {
            query += ' AND LOWER(M.Language) = LOWER(@Language)';
            request.input('Language', sql.VarChar, language);
        }

        if (releaseYearFrom) {
            query += ' AND YEAR(M.ReleaseDate) >= @ReleaseYearFrom';
            request.input('ReleaseYearFrom', sql.Int, releaseYearFrom);
        }

        if (releaseYearTo) {
            query += ' AND YEAR(M.ReleaseDate) <= @ReleaseYearTo';
            request.input('ReleaseYearTo', sql.Int, releaseYearTo);
        }

        if (imdbRatingMin) {
            query += ' AND M.IMDB_Rating >= @IMDBRatingMin';
            request.input('IMDBRatingMin', sql.Decimal(3,1), imdbRatingMin);
        }

        if (imdbRatingMax) {
            query += ' AND M.IMDB_Rating <= @IMDBRatingMax';
            request.input('IMDBRatingMax', sql.Decimal(3,1), imdbRatingMax);
        }

        if (fmdbRatingMin) {
            query += ' AND M.FMDB_Rating >= @FMDBRatingMin';
            request.input('FMDBRatingMin', sql.Decimal(3,1), fmdbRatingMin);
        }

        if (fmdbRatingMax) {
            query += ' AND M.FMDB_Rating <= @FMDBRatingMax';
            request.input('FMDBRatingMax', sql.Decimal(3,1), fmdbRatingMax);
        }

        if (movieLength) {
            query += ' AND M.MovieLength = @MovieLength';
            request.input('MovieLength', sql.VarChar, movieLength);
        }

        if (director) {
            query += ' AND LOWER(D.DirectorName) LIKE LOWER(@Director)';
            request.input('Director', sql.VarChar, `%${director}%`);
        }

        if (actor) {
            query += ' AND LOWER(A.ActorName) LIKE LOWER(@Actor)';
            request.input('Actor', sql.VarChar, `%${actor}%`);
        }

        if (writer) {
            query += ' AND LOWER(W.WriterName) LIKE LOWER(@Writer)';
            request.input('Writer', sql.VarChar, `%${writer}%`);
        }

        if (keyword) {
            query += ' AND LOWER(K.KeywordName) LIKE LOWER(@Keyword)';
            request.input('Keyword', sql.VarChar, `%${keyword}%`);
        }

        const result = await request.query(query);
        const movies = await processMoviesWithDirectors(result.recordset);
        res.json({ success: true, movies });
    } catch (err) {
        console.error('Error during advanced movie discovery:', err.message);
        res.status(500).send({success:false, message: 'Error during movie discovery'});
    }
});

// Get total page# of all movies or series
router.get('/pageCount', async (req, res) => {
    const type = req.query.type?.toLowerCase() === 'series' ? 'Series' : 'Movie'; // Default to 'Movie'
    const pageSize = 25; // Number of movies per page

    try {
        // SQL query to count the total number of movies or series
        const query = `
            SELECT COUNT(*) AS TotalCount
            FROM Movies
            WHERE Type = @type;
        `;

        const request = new sql.Request();
        request.input('type', sql.VarChar, type);

        const result = await request.query(query);
        const totalCount = result.recordset[0].TotalCount;
        const totalPages = Math.ceil(totalCount / pageSize); // Calculate total pages

        res.json({ success: true, totalPages: totalPages });
    } catch (error) {
        console.error('Error fetching total movie page count:', error.message);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// Get All Movies by Page# (with pagination) sort params = releaseDate, FMBD_Rating, IMDB_Rating, Title
router.get('/page', async (req, res) => {
    const page = parseInt(req.query.page, 10) || 1; // Default to page 1 if not provided
    const sortParam = req.query.sort || 'ReleaseDate'; // Default sort by ReleaseDate
    const sortOrder = req.query.order.toLowerCase() === 'asc' ? 'ASC' : 'DESC'; // Default to descending order
    const type = req.query.type?.toLowerCase() === 'series' ? 'Series' : 'Movie'; // Default to 'Movie'
    const pageSize = 25; // Number of movies per page
    const offset = (page - 1) * pageSize; // Calculate the offset for pagination

    if (page < 1) {
        return res.status(400).json({ success: false, message: 'Page number must be greater than or equal to 1' });
    }

    // Validate sortParam to prevent SQL injection
    const validSortParams = ['releasedate', 'fmdb_rating', 'imdb_rating', 'title']; // Convert to lowercase
    if (!validSortParams.includes(sortParam.toLowerCase())) {
        return res.status(400).json({ success: false, message: 'Invalid sort parameter' });
    }

    try {
        // SQL query to fetch movies with pagination and dynamic sorting
        const query = `
            SELECT M.MovieID, M.Title, M.MoviePosterLink
            FROM Movies M
            WHERE M.Type = @type
            ORDER BY M.${sortParam} ${sortOrder}
            OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
        `;

        const request = new sql.Request();
        request.input('offset', sql.Int, offset);
        request.input('pageSize', sql.Int, pageSize);
        request.input('type', sql.VarChar, type); // Use sql.VarChar for string input

        const result = await request.query(query);

        if (result.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'No movies found for the given page' });
        }

        const response = await processMoviesWithDirectors(result.recordset);
        res.json({ success: true, movies: response });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

// Get movie details by ID
router.get('/details/:movieId', async (req, res) => {
    const movieId = parseInt(req.params.movieId, 10); // Parse movieId as an integer

    if (isNaN(movieId)) {
        return res.status(400).json({ success: false, message: 'Invalid movieId' });
    }
    
    try {
        // SQL query to fetch movie details and genres
        const query = `
            SELECT M.Title, M.ReleaseDate, M.Synopsis, M.MovieLength, M.MoviePosterLink, 
                M.MovieBackdropLink, M.Language, M.IMDB_Rating, M.FMDB_Rating, 
                M.Awards, M.BoxOffice, M.MPAA_Rating, M.MovieID, M.Type
            FROM Movies M WHERE M.MovieID = @movieId;

            SELECT STRING_AGG(G.GenreName, ', ') AS Genres
            FROM MovieGenres MG 
            LEFT JOIN Genres G ON MG.GenreID = G.GenreID
            WHERE MG.MovieID = @movieId
            GROUP BY MG.MovieID;
        `;

        // Create a new SQL request
        const request = new sql.Request();
        request.input('movieId', sql.Int, movieId);

        // Execute the query
        const result = await request.query(query);

        // Check if the movie exists
        if (result.recordsets[0].length === 0) {
            res.status(404).json({ success: false, message: 'Movie not found' });
        }

        // Extract movie details
        const movie = result.recordsets[0][0];
        const genres = result.recordsets[1][0]?.Genres || ''; // Handle case where genres might be null
        const response = {
            title: movie.Title,
            releaseDate: movie.ReleaseDate,
            synopsis: movie.Synopsis,
            movieLength: movie.MovieLength,
            moviePosterLink: movie.MoviePosterLink,
            movieBackdropLink: movie.MovieBackdropLink,
            language: movie.Language,
            imdbRating: movie.IMDB_Rating,
            fmdbRating: movie.FMDB_Rating,
            awards: movie.Awards,
            boxOffice: movie.BoxOffice,
            mpaaRating: movie.MPAA_Rating,
            movieId: movie.MovieID,
            type: movie.Type,
            genres: genres ? genres.split(', ') : [] // Convert genres string to an array
        };

        res.json({ success: true, movie: response }); // Send the formatted JSON response
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

// Get Cast & Crew by movieId
router.get('/cast/:movieId', async (req, res) => {
    const movieId = parseInt(req.params.movieId, 10); // Parse movieId as an integer

    if (isNaN(movieId)) {
        return res.status(400).json({ message: 'Invalid movieId' });
    }
        try {
            // SQL queries to fetch writers, directors, and actors
            const query = `
                SELECT W.WriterName FROM MovieWriters MW
                JOIN Writers W ON MW.WriterID = W.WriterID
                WHERE MW.MovieID = @movieId;
    
                SELECT D.DirectorName FROM MovieDirectors MD
                JOIN Directors D ON MD.DirectorID = D.DirectorID
                WHERE MD.MovieID = @movieId;
    
                SELECT A.ActorName, MA.CharacterName FROM MovieActors MA
                JOIN Actors A ON MA.ActorID = A.ActorID
                WHERE MA.MovieID = @movieId;
            `;
    
            // Create a new SQL request
            const request = new sql.Request();
            request.input('movieId', sql.Int, movieId);
    
            // Execute the query
            const result = await request.query(query);
    
            // Extract results
            const writers = result.recordsets[0].map(row => row.WriterName);
            const directors = result.recordsets[1].map(row => row.DirectorName);
            const actors = result.recordsets[2].map(row => ({
                name: row.ActorName,
                character: row.CharacterName
            }));

        res.json({ success: true, writers: writers, directors: directors, actors: actors }); // Send the formatted JSON response
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

// Get top 5 trending movies based on count of overall logged movies over the course of 7 days
router.get('/trending', async (req, res) => {
    const query = `
        SELECT t.MovieID, t.Title, t.MoviePosterLink
        FROM (SELECT TOP 5 M.MovieID, M.Title, M.MoviePosterLink, COUNT(A.IsLogged) as WatchCount
            FROM Movies M JOIN Activity A ON M.MovieID = A.MovieID
            WHERE A.IsLogged = 1 AND DATEDIFF(DAY, A.ActivityDateTime, GETDATE()) <= 7
            GROUP BY M.MovieID, M.Title, M.MoviePosterLink
            ORDER BY WatchCount DESC) t 
    `;

    try {
        const request = new sql.Request();
        const result = await request.query(query);

        // if no movies found due to incomplete data in activities, fill remaining with random movies
        if (result.recordset.length < 5) {
            const missingCount = 5 - result.recordset.length;
            const randomQuery = `
                SELECT TOP ${missingCount} MovieID, Title, MoviePosterLink
                FROM Movies
                WHERE MovieID NOT IN (${result.recordset.length > 0 ? result.recordset.map(row => `'${row.MovieID}'`).join(',') : '-1'})
                ORDER BY NEWID()
            `;  // newid() is a random function in SQL Server to get random rows

            const randomResult = await request.query(randomQuery);
            result.recordset.push(...randomResult.recordset);
        } 
        
        
        const response = await processMoviesWithDirectors(result.recordset);
        res.json({ success: true, movies: response }); // Send the formatted JSON response
    } catch (error) {
        res.status(500).json({ message: 'Internal server error', error: error.message });
    }
});

// Get 5 Recent Movies from Distinct Friend's Activities
router.get('/friends', authenticateToken, async (req, res) => {
    const userId = req.userId; // Extract userId from the token payload

    try {
        // Fetch the user's friends
        const friendsQuery = `
                SELECT User2ID FROM Friends WHERE User1ID = @CurrentUserID
                UNION
                SELECT User1ID FROM Friends WHERE User2ID = @CurrentUserID
        `;
        const friendsRequest = new sql.Request();
        friendsRequest.input('CurrentUserID', sql.Int, userId);
        const friendsResult = await friendsRequest.query(friendsQuery);

        if (friendsResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'No friends found' });
        }

        const friendIdsString = friendsResult.recordset.map(row => row.User2ID).join(', ');

        // Fetch the 5 most recent movies watched by friends
        const recentMoviesQuery = `
            WITH RankedActivity AS (
                SELECT 
                    M.MovieID,
                    M.Title,
                    M.MoviePosterLink,
                    A.ActivityDateTime,
                    U.Username,
                    ROW_NUMBER() OVER (PARTITION BY A.UserID ORDER BY A.ActivityDateTime DESC) AS rn
                FROM Activity A
                JOIN Movies M ON A.MovieID = M.MovieID
                JOIN Users U ON U.UserID = A.UserID
                WHERE A.UserID IN (${friendIdsString})
            ),
            FilteredMovies AS (
                SELECT 
                    MovieID,
                    Title,
                    MoviePosterLink,
                    Username, 
                    ROW_NUMBER() OVER (PARTITION BY MovieID ORDER BY ActivityDateTime DESC) AS new
                FROM RankedActivity
                WHERE rn = 1
            )
            SELECT TOP 5
                MovieID,
                Title,
                MoviePosterLink,
                Username
            FROM FilteredMovies
            WHERE new = 1
        `;
        const recentMoviesRequest = new sql.Request();
        const recentMoviesResult = await recentMoviesRequest.query(recentMoviesQuery);

        if (recentMoviesResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'No recent friend activities found' });
        }
        
        const response = await processMoviesWithDirectors(recentMoviesResult.recordset);
        res.json({ success: true, movies: response });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});

// Get 5 Recent Movies added to watchlist by friends
router.get('/friends/watchlist', authenticateToken, async (req, res) => {
    const userId = req.userId; // Extract userId from the token payload

    try {
        // Fetch the user's friends
        const friendsQuery = `
                SELECT User2ID FROM Friends WHERE User1ID = @CurrentUserID
                UNION
                SELECT User1ID FROM Friends WHERE User2ID = @CurrentUserID
        `;
        const friendsRequest = new sql.Request();
        friendsRequest.input('CurrentUserID', sql.Int, userId);
        const friendsResult = await friendsRequest.query(friendsQuery);

        if (friendsResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'No friends found' });
        }
        const friendIdsString = friendsResult.recordset.map(row => row.User2ID).join(', ');

        // Fetch the 5 most recent movies added to watchlist by friends
        const recentMoviesQuery = `
            WITH RankedWatchlist AS (
                SELECT 
                    M.MovieID,
                    M.Title,
                    M.MoviePosterLink,
                    UW.AddedAt,
                    U.Username,
                    ROW_NUMBER() OVER (PARTITION BY UW.UserID ORDER BY UW.AddedAt DESC) AS rn
                FROM UserWatchlist UW
                JOIN Movies M ON UW.MovieID = M.MovieID
                JOIN Users U ON UW.UserID = U.UserID
                WHERE UW.UserID IN (${friendIdsString})
            ),
            FilteredMovies AS (
                SELECT 
                    MovieID,
                    Title,
                    MoviePosterLink,
                    AddedAt,
                    Username, 
                    ROW_NUMBER() OVER (PARTITION BY MovieID ORDER BY AddedAt DESC) AS new
                FROM RankedWatchlist
                WHERE rn = 1
            )
            SELECT TOP 5 
                MovieID,
                Title,
                MoviePosterLink,
                Username
            FROM FilteredMovies
            WHERE new = 1
            ORDER BY AddedAt DESC;
        `;
        const recentMoviesRequest = new sql.Request();
        const recentMoviesResult = await recentMoviesRequest.query(recentMoviesQuery);

        if (recentMoviesResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'No recent friend activities found' });
        }

        const response = await processMoviesWithDirectors(recentMoviesResult.recordset);
        res.json({ success: true, movies: response });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});

// Get 5 Recommendations based on user's log history via keyword + genre matching
router.get('/recommended', authenticateToken, async (req, res) => {
    const userId = req.userId; // Extract userId from the token payload

    try {
        // Fetch 1 movie from users's 3 most recent logged movies to get keywords
        const recentMoviesQuery = `
            SELECT TOP 1 *
            FROM (
                SELECT TOP 3 M.MovieID, M.Title
                FROM Activity A
                JOIN Movies M ON A.MovieID = M.MovieID
                WHERE A.UserID = @CurrentUserID AND A.IsLogged = 1
                ORDER BY A.ActivityDateTime DESC
            ) AS TopThree
            ORDER BY NEWID();
        `;
        const recentMoviesRequest = new sql.Request();
        recentMoviesRequest.input('CurrentUserID', sql.Int, userId);
        const recentMoviesResult = await recentMoviesRequest.query(recentMoviesQuery);

        
        if (recentMoviesResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'No logged movies found' });
        }

        // Fetch the logged movie's keywords
        const keywordsQuery = `
            SELECT MK.KeywordID 
            FROM MovieKeywords MK 
            WHERE MK.MovieID = @MovieID
        `;
        const keywordsRequest = new sql.Request();
        keywordsRequest.input('MovieID', sql.Int, recentMoviesResult.recordset[0].MovieID);
        const keywordsResult = await keywordsRequest.query(keywordsQuery);

        const keywordIdsString = keywordsResult.recordset.map(row => row.KeywordID).join(', ');

        // Fetch the logged movie's genres
        const genresQuery = `
            SELECT MG.GenreID 
            FROM MovieGenres MG 
            WHERE MG.MovieID = @MovieID
        `;
        const genresRequest = new sql.Request();
        genresRequest.input('MovieID', sql.Int, recentMoviesResult.recordset[0].MovieID);
        const genresResult = await genresRequest.query(genresQuery);

        const genreIdsString = genresResult.recordset.map(row => row.GenreID).join(', ');

        // Fetch recommendations based on keywords
        let recommendationsQuery = `
            SELECT TOP 5 M.MovieID, M.Title, M.MoviePosterLink
            FROM Movies M 
            JOIN MovieKeywords MK ON M.MovieID = MK.MovieID
            WHERE MK.KeywordID IN (${keywordIdsString}) AND M.MovieID != @MovieID
            GROUP BY M.MovieID, M.Title, M.MoviePosterLink
            ORDER BY NEWID();
        `;
        const recommendationsRequest = new sql.Request();
        recommendationsRequest.input('MovieID', sql.Int, recentMoviesResult.recordset[0].MovieID);
        let recommendationsResult = await recommendationsRequest.query(recommendationsQuery);

        // If fewer than 5 movies are found, fetch additional movies based on genres
        if (recommendationsResult.recordset.length < 5) {
            const missingCount = 5 - recommendationsResult.recordset.length;
            const genreRecommendationsQuery = `
                SELECT TOP ${missingCount} M.MovieID, M.Title, M.MoviePosterLink
                FROM Movies M 
                JOIN MovieGenres MG ON M.MovieID = MG.MovieID
                WHERE MG.GenreID IN (${genreIdsString}) 
                AND M.MovieID NOT IN (${recommendationsResult.recordset.map(row => row.MovieID).join(', ') || '-1'}, @MovieID)
                GROUP BY M.MovieID, M.Title, M.MoviePosterLink
                ORDER BY NEWID();
            `;
            const genreRecommendationsRequest = new sql.Request();
            genreRecommendationsRequest.input('MovieID', sql.Int, recentMoviesResult.recordset[0].MovieID);
            const genreRecommendationsResult = await genreRecommendationsRequest.query(genreRecommendationsQuery);

            // Combine keyword-based and genre-based recommendations
            recommendationsResult.recordset.push(...genreRecommendationsResult.recordset);
        }

        if (recommendationsResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'No recommendations found' });
        }

        const response = await processMoviesWithDirectors(recommendationsResult.recordset);
        res.status(200).json({ success: true, recommendedOn: recentMoviesResult.recordset[0].Title , movies: response });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});

// Get isMovieExists status of a movie (requires movieId in request params)
router.get('/check/:movieId', async (req, res) => {
    const { movieId } = req.params;
  
    if (!movieId || isNaN(movieId)) {
      return res.status(400).json({ exists: false, message: 'Invalid Movie ID' });
    }
  
    try {
      const checkMovieQuery = 'SELECT MovieID FROM Movies WHERE MovieID = @movieId';
      const movieRequest = new sql.Request();
      movieRequest.input('movieId', sql.Int, parseInt(movieId));
      
      const movieCheckResult = await movieRequest.query(checkMovieQuery);
  
      const exists = movieCheckResult.recordset.length > 0;
  
      return res.status(200).json({ exists });
    } catch (err) {
      console.error('Error checking movie:', err);
      return res.status(500).json({ exists: false, message: 'Server error' });
    }
});

// Add Movie to liked movies
router.post('/like/:movieId', authenticateToken, async (req, res) => {
        const movieId = req.params.movieId;
        const userId = req.userId; // Extract userId from the token payload
    
        try {
            // Check if the movie exists in the database
            const checkMovieQuery = 'SELECT MovieID FROM Movies WHERE MovieID = @movieId';
            const movieRequest = new sql.Request();
            movieRequest.input('movieId', sql.Int, movieId);
            const movieCheckResult = await movieRequest.query(checkMovieQuery);
    
            if (movieCheckResult.recordset.length === 0) {
                return res.status(404).json({ success: false, message: 'Movie not found' });
            }
    
            // Check if the user has already liked the movie
            const checkLikeQuery = 'SELECT * FROM UserLikedMovies WHERE MovieID = @movieId AND UserID = @userId';
            const likeCheckRequest = new sql.Request();
            likeCheckRequest.input('movieId', sql.Int, movieId);
            likeCheckRequest.input('userId', sql.Int, userId);
            const likeCheckResult = await likeCheckRequest.query(checkLikeQuery);
    
            if (likeCheckResult.recordset.length === 1) {
                return res.status(400).json({ success: false, message: 'You have already liked this movie' });
            }
    
            // Insert the like into the database
            const insertLikeQuery = 'INSERT INTO UserLikedMovies (MovieID, UserID) VALUES (@movieId, @userId)';
            const insertLikeRequest = new sql.Request();
            insertLikeRequest.input('movieId', sql.Int, movieId);
            insertLikeRequest.input('userId', sql.Int, userId);
    
            await insertLikeRequest.query(insertLikeQuery);
            res.status(200).json({ success: true, message: 'Movie liked successfully' });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
        }
});

// Unlike a movie (requires JWT token containing userId and movieId in request params)
router.delete('/like/:movieId', authenticateToken, async (req, res) => {
    const movieId = req.params.movieId;
    const userId = req.userId; // Extract userId from the token payload

    try {
        // Check if the movie like exists in the database
        const checkLikeQuery = 'SELECT * FROM UserLikedMovies WHERE MovieID = @movieId AND UserID = @userId';
        const likeRequest = new sql.Request();
        likeRequest.input('movieId', sql.Int, movieId);
        likeRequest.input('userId', sql.Int, userId);
        const likeCheckResult = await likeRequest.query(checkLikeQuery);

        if (likeCheckResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Movie not liked' });
        }

        // Delete the like from the database
        const deleteLikeQuery = 'DELETE FROM UserLikedMovies WHERE MovieID = @movieId AND UserID = @userId';
        const deleteLikeRequest = new sql.Request();
        deleteLikeRequest.input('movieId', sql.Int, movieId);
        deleteLikeRequest.input('userId', sql.Int, userId);

        await deleteLikeRequest.query(deleteLikeQuery);
        res.status(200).json({ success: true, message: 'Movie unliked successfully' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});

// Get IsLiked status of a movie (requires userId and movieId in query parameters)
router.get('/like', async (req, res) => {
    const { movieId, userId } = req.query; // Extract from query parameters

    if (!movieId || !userId) {
        return res.status(400).json({ success: false, message: 'movieId and userId are required in the query parameters' });
    }
    // Validate that movieId and userId are integers
    if (!Number.isInteger(parseInt(movieId, 10)) || !Number.isInteger(parseInt(userId, 10))) {
        return res.status(400).json({ success: false, message: 'movieId and userId must be integers' });
    }

    try {
        // Check if the movie is liked by the user
        const checkLikeQuery = 'SELECT * FROM UserLikedMovies WHERE MovieID = @movieId AND UserID = @userId';
        const likeRequest = new sql.Request();
        likeRequest.input('movieId', sql.Int, parseInt(movieId, 10));
        likeRequest.input('userId', sql.Int, parseInt(userId, 10));
        const likeCheckResult = await likeRequest.query(checkLikeQuery);

        if (likeCheckResult.recordset.length === 0) {
            return res.status(200).json({ success: true, isLiked: false });
        } else {
            return res.status(200).json({ success: true, isLiked: true });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
});

module.exports = router;
