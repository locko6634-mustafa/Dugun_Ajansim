export const asyncHandler = (handler) => (req, res, next) => {
    void handler(req, res, next).catch(next);
};
