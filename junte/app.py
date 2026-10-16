from flask import Flask, render_template

app = Flask(__name__)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/live")
def live():
    return render_template("live.html")

@app.route("/cuenta")
def cuenta():
    return render_template("cuenta.html")

@app.route("/admin")
def admin():
    return render_template("admin.html")

@app.route("/retos")
def retos():
    return render_template("retos.html")

@app.route("/reglamento")
def reglamento():
    return render_template("reglamento.html")

@app.route("/musica")
def musica():
    return render_template("musica.html")

if __name__ == "__main__":
    app.run(debug=True, port=5001)
